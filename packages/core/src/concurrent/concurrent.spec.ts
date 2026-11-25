import { afterEach, describe, expect, test, vi } from "vitest";
import { pickFirstBalancer } from "../balancer";
import type { Balancer, DoneInfo } from "../balancer";
import {
  createClient,
  withBalancer,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
  withWebSocketHandle,
} from "../client";
import type { PreflightFault } from "../error";
import { ERR_TIMEOUT } from "../error";
import { defineRequest, makeResponse } from "../http";
import { concurrencyLimitHttpInterceptor } from "../interceptor";
import { defineEventStream } from "../sse";
import { struct } from "../struct";
import { defineWebSocket } from "../web_socket";
import { createFakeWebSocket } from "../../test/fake_web_socket";
import {
  concurrentAll,
  concurrentAllSettled,
  concurrentMap,
  concurrentMapSettled,
} from "./index";

describe("@defjs/core/concurrent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getOrder = defineRequest({
    method: "GET",
    path: "/orders/:id",
    input: struct.object({ id: struct.number() }),
    builder: ({ id }) => ({ path: { id } }),
    output: struct.object({ id: struct.number(), name: struct.string() }),
    error: struct.object({ reason: struct.string() }),
  });

  const getOptional = defineRequest({
    method: "GET",
    path: "/opt",
    input: struct.object({ tag: struct.string() }).optional(),
    builder: (input) => (input ? { query: { tag: input.tag } } : {}),
    output: struct.object({ ok: struct.boolean() }),
  });

  const getHealth = defineRequest({
    method: "GET",
    path: "/health",
  });

  test("concurrentMap validates concurrency option and handles empty arrays", async () => {
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() =>
        Promise.resolve(Response.json({ id: 1, name: "a" })),
      ),
    );

    for (const invalid of [0, -2, 1.5, Number.NaN]) {
      await expect(
        concurrentMap(client, getOrder, [{ id: 1 }], { concurrency: invalid }),
      ).rejects.toThrow(RangeError);
      await expect(
        concurrentMapSettled(client, getOrder, [], { concurrency: invalid }),
      ).rejects.toThrow(RangeError);
    }

    await expect(
      concurrentMap(client, getOrder, [], {
        concurrency: Number.POSITIVE_INFINITY,
      }),
    ).resolves.toEqual([null, [], []]);
    await expect(concurrentMapSettled(client, getOrder, [])).resolves.toEqual(
      [],
    );

    const aborted = new AbortController();
    aborted.abort("cancelled");
    const [preErr] = await concurrentMap(client, getOrder, [], {
      signal: aborted.signal,
    });
    expect(preErr?.code).toBe("NET_ABORTED");

    const timedOut = new AbortController();
    timedOut.abort(ERR_TIMEOUT);
    const [timeoutErr] = await concurrentMap(
      client({ signal: timedOut.signal }),
      getOrder,
      [],
    );
    expect(timeoutErr?.code).toBe("NET_TIMEOUT");
  });

  test("concurrentMap preserves input order despite out-of-order settlement and caps in-flight concurrency", async () => {
    const gates = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<Response>>
    >();
    let inFlight = 0;
    let maxInFlight = 0;
    let progressCount = 0;

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle((input) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const gate = Promise.withResolvers<Response>();
        gates.set(url.pathname, gate);
        return gate.promise.finally(() => {
          inFlight -= 1;
        });
      }),
    );

    const derived = client({
      onDownloadProgress: () => {
        progressCount += 1;
      },
    });

    const batch = concurrentMap(
      derived,
      getOrder,
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      { concurrency: 2 },
    );

    await vi.waitFor(() => expect(gates.size).toBe(2));
    expect(maxInFlight).toBe(2);

    // Finish id=2 before id=1 to assert result order preservation.
    gates.get("/orders/2")?.resolve(Response.json({ id: 2, name: "two" }));
    await vi.waitFor(() => expect(gates.has("/orders/3")).toBe(true));

    gates.get("/orders/1")?.resolve(Response.json({ id: 1, name: "one" }));
    await vi.waitFor(() => expect(gates.has("/orders/4")).toBe(true));

    gates.get("/orders/4")?.resolve(Response.json({ id: 4, name: "four" }));
    gates.get("/orders/3")?.resolve(Response.json({ id: 3, name: "three" }));

    const [err, orders, responses] = await batch;
    expect(err).toBeNull();
    if (err !== null) throw err;
    expect(maxInFlight).toBe(2);
    expect(progressCount).toBe(4);
    expect(orders).toEqual([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
      { id: 3, name: "three" },
      { id: 4, name: "four" },
    ]);
    expect(responses.map((r) => r.body)).toEqual(orders);

    // Optional-input operation accepts undefined entries cleanly.
    const optClient = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() => Promise.resolve(Response.json({ ok: true }))),
    );
    const [optErr, optValues] = await concurrentMap(optClient, getOptional, [
      { tag: "x" },
      undefined,
    ]);
    expect(optErr).toBeNull();
    expect(optValues).toEqual([{ ok: true }, { ok: true }]);
  });

  test("concurrentMap composes orthogonally with concurrencyLimitHttpInterceptor", async () => {
    let inFlight = 0;
    let peak = 0;
    const gates: Array<ReturnType<typeof Promise.withResolvers<Response>>> = [];

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withInterceptors(concurrencyLimitHttpInterceptor({ maxConcurrency: 2 })),
      withHTTPHandle(() => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const gate = Promise.withResolvers<Response>();
        gates.push(gate);
        return gate.promise.finally(() => {
          inFlight -= 1;
        });
      }),
    );

    const pending = concurrentMap(
      client,
      getOrder,
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      { concurrency: 4 },
    );

    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(peak).toBe(2);

    gates.shift()?.resolve(Response.json({ id: 1, name: "1" }));
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(peak).toBe(2);

    gates.shift()?.resolve(Response.json({ id: 2, name: "2" }));
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates.shift()?.resolve(Response.json({ id: 3, name: "3" }));
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates.shift()?.resolve(Response.json({ id: 4, name: "4" }));

    const [err, items] = await pending;
    expect(err).toBeNull();
    expect(items).toHaveLength(4);
    expect(peak).toBe(2);
  });

  test("concurrentMap fails fast on first fault, aborts siblings, waits for balancer done(), and ignores secondary concurrent faults", async () => {
    const doneCalls: DoneInfo[] = [];
    const baseBalancer = pickFirstBalancer();
    const spyBalancer: Balancer = {
      pick(info) {
        const res = baseBalancer.pick(info);
        if (res[0] !== null) return res;
        const inner = res[1];
        return [
          null,
          {
            ...inner,
            done(doneInfo) {
              doneCalls.push(doneInfo);
              inner.done?.(doneInfo);
            },
          },
        ];
      },
    };

    const siblingSignals: AbortSignal[] = [];
    const slowSibling = Promise.withResolvers<void>();
    let startedCount = 0;

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withBalancer(spyBalancer),
      withHTTPHandle((input) => {
        startedCount += 1;
        const req = input instanceof Request ? input : new Request(input);
        const id = new URL(req.url).pathname.split("/").at(-1);
        if (id === "1") {
          return Promise.resolve(
            Response.json({ reason: "first-bad" }, { status: 400 }),
          );
        }
        if (id === "2") {
          return Promise.resolve(
            Response.json({ reason: "second-bad" }, { status: 409 }),
          );
        }
        siblingSignals.push(req.signal);
        return new Promise<Response>((resolve) => {
          req.signal.addEventListener(
            "abort",
            () => {
              queueMicrotask(() => {
                resolve(Response.json({ reason: "late" }, { status: 500 }));
                slowSibling.resolve();
              });
            },
            { once: true },
          );
        });
      }),
    );

    const [err, results, metas] = await concurrentMap(
      client,
      getOrder,
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      { concurrency: 3 },
    );

    await slowSibling.promise;
    expect(results).toBeUndefined();
    expect(metas).toBeUndefined();
    expect(err?.code).toBe("HTTP_STATUS");
    if (err?.code === "HTTP_STATUS") {
      expect(err.status).toBe(400);
      expect(err.data).toEqual({ reason: "first-bad" });
    }
    expect(siblingSignals[0]?.aborted).toBe(true);
    // Item 4 was never started because concurrency=3 filled slots 1..3 and aborted before polling slot 4.
    expect(startedCount).toBe(3);
    expect(doneCalls).toHaveLength(3);
  });

  test("caller signal abort takes precedence over sibling fault and stops tasks ignoring signals", async () => {
    const batchCtrl = new AbortController();
    const siblingGate = Promise.withResolvers<Response>();
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle((input) => {
        const id = new URL(
          input instanceof Request ? input.url : String(input),
        ).pathname
          .split("/")
          .at(-1);
        if (id === "1") {
          return Promise.resolve(
            Response.json({ reason: "bad" }, { status: 400 }),
          );
        }
        return siblingGate.promise;
      }),
    );

    const pending = concurrentMap(client, getOrder, [{ id: 1 }, { id: 2 }], {
      signal: batchCtrl.signal,
    });
    await vi.waitFor(() => expect(siblingGate).toBeDefined());
    batchCtrl.abort("caller stop");
    siblingGate.resolve(Response.json({ reason: "late" }, { status: 500 }));

    const [err] = await pending;
    expect(err?.code).toBe("NET_ABORTED");

    // Task that ignores req.signal: caller abort still stops remaining queued tasks and returns caller abort fault.
    const ignoreCtrl = new AbortController();
    let invoked = 0;
    const [ignoredErr] = await concurrentAll(
      client,
      [
        () => {
          invoked += 1;
          ignoreCtrl.abort(ERR_TIMEOUT);
          return Promise.resolve([
            null,
            "ok",
            makeResponse({ status: 200 }),
          ] as const);
        },
        () => {
          invoked += 1;
          return Promise.resolve([
            null,
            "skipped",
            makeResponse({ status: 200 }),
          ] as const);
        },
      ],
      { concurrency: 1, signal: ignoreCtrl.signal },
    );
    expect(invoked).toBe(1);
    expect(ignoredErr?.code).toBe("NET_TIMEOUT");
  });

  test("concurrentMapSettled keeps partial successes/faults and fills unstarted slots when signal aborts", async () => {
    const abortCtrl = new AbortController();
    let fetchCount = 0;

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle((input) => {
        fetchCount += 1;
        const id = new URL(
          input instanceof Request ? input.url : String(input),
        ).pathname
          .split("/")
          .at(-1);
        if (id === "1") {
          return Promise.resolve(Response.json({ id: 1, name: "one" }));
        }
        if (id === "2") {
          return Promise.resolve(
            Response.json({ reason: "fail-2" }, { status: 422 }),
          );
        }
        abortCtrl.abort(ERR_TIMEOUT);
        return Promise.resolve(
          Response.json({ id: Number(id), name: "other" }),
        );
      }),
    );

    const settled = await concurrentMapSettled(
      client,
      getOrder,
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      { concurrency: 1, signal: abortCtrl.signal },
    );

    expect(fetchCount).toBe(3);
    expect(settled).toHaveLength(4);
    expect(settled[0]?.[0]).toBeNull();
    expect(settled[0]?.[1]).toEqual({ id: 1, name: "one" });
    expect(settled[1]?.[0]?.code).toBe("HTTP_STATUS");
    expect(settled[2]?.[0]?.code).toBe("NET_TIMEOUT");
    expect(settled[3]?.[0]?.code).toBe("NET_TIMEOUT");
    expect(settled[3]?.[1]).toBeUndefined();
  });

  test("concurrentAll & concurrentAllSettled support tuples, records, empty containers, and __proto__", async () => {
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle((input) => {
        const path = new URL(
          input instanceof Request ? input.url : String(input),
        ).pathname;
        if (path === "/health") {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        return Promise.resolve(Response.json({ id: 9, name: "nine" }));
      }),
    );

    const emptyTuple = await concurrentAll(client, []);
    expect(emptyTuple).toEqual([null, [], []]);
    const emptyRec = await concurrentAll(client, {});
    expect(emptyRec).toEqual([null, {}, {}]);
    await expect(concurrentAllSettled(client, {})).resolves.toEqual({});

    const [tupleErr, tupleValues, tupleMetas] = await concurrentAll(client, [
      (c) => getOrder(c, { id: 9 }),
      (c) => getHealth(c),
      () => Promise.resolve([null, "two-tuple"] as const),
    ]);

    expect(tupleErr).toBeNull();
    if (tupleErr !== null) throw tupleErr;
    const [orderVal, healthVal, customVal] = tupleValues;
    const [orderMeta, healthMeta, customMeta] = tupleMetas;
    expect(orderVal).toEqual({ id: 9, name: "nine" });
    expect(healthVal).toBeUndefined();
    expect(customVal).toBe("two-tuple");
    expect(orderMeta.status).toBe(200);
    expect(healthMeta.status).toBe(200);
    expect(customMeta).toBeUndefined();

    const protoKey = "__proto__";
    const [recErr, recData, recMetas] = await concurrentAll(client, {
      order: (c) => getOrder(c, { id: 9 }),
      health: (c) => getHealth(c),
      [protoKey]: (c) => getHealth(c),
    });
    expect(recErr).toBeNull();
    expect(recData?.order).toEqual({ id: 9, name: "nine" });
    expect(recData?.health).toBeUndefined();
    expect(Object.hasOwn(recData ?? {}, "__proto__")).toBe(true);
    expect(recMetas?.order.status).toBe(200);

    const recSettled = await concurrentAllSettled(client, {
      order: (c) => getOrder(c, { id: 9 }),
      [protoKey]: (c) => getHealth(c),
    });
    expect(recSettled.order[0]).toBeNull();
    expect(Object.hasOwn(recSettled, "__proto__")).toBe(true);

    // Failing record batch returns [fault, undefined, undefined].
    const [failRecErr, failRecData] = await concurrentAll(client, {
      bad: () =>
        Promise.resolve([
          {
            ...new Error("bad"),
            name: "DefjsFault",
            code: "REQ_BUILD_FAILED",
            response: undefined,
          } satisfies PreflightFault,
          undefined,
          undefined,
        ] as const),
    });
    expect(failRecErr?.code).toBe("REQ_BUILD_FAILED");
    expect(failRecData).toBeUndefined();
  });

  test("manages SSE and WebSocket lifecycle: rollback on failure and signal retention until close on success", async () => {
    const fakeWs = createFakeWebSocket({ handshake: "auto" });
    const stream = defineEventStream({
      path: "/events",
      events: { ping: struct.object({ seq: struct.number() }) },
    });
    const socket = defineWebSocket({
      path: "/ws",
      incoming: struct.object({ msg: struct.string() }),
    });

    const sseControllers: Array<ReadableStreamDefaultController<Uint8Array>> =
      [];
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withSSEHandle(() =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                sseControllers.push(controller);
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
      ),
      withWebSocketHandle(fakeWs.Socket),
      withHTTPHandle(() =>
        Promise.resolve(
          Response.json({ reason: "late-fail" }, { status: 500 }),
        ),
      ),
    );

    // Success case: signal listeners stay attached until handles close, and aborting caller signal closes them.
    const liveCtrl = new AbortController();
    const [okErr, okHandles] = await concurrentAll(
      client,
      [(c) => stream(c), (c) => socket(c)],
      { signal: liveCtrl.signal },
    );
    expect(okErr).toBeNull();
    if (okErr !== null) throw okErr;
    const [sseHandle, wsSession] = okHandles;
    expect(sseHandle.open.response.status).toBe(200);
    expect(wsSession.state).toBe("open");

    liveCtrl.abort("shutdown");
    await expect(sseHandle.closed).resolves.toMatchObject({ kind: "aborted" });
    await expect(wsSession.closed).resolves.toMatchObject({ kind: "aborted" });

    // Rollback case: SSE & WS opened first, then a throwing close() custom handle AND a failing HTTP call trigger rollback.
    let closedHandles = 0;
    const throwingHandle = {
      close() {
        closedHandles += 1;
        throw new Error("close failed cleanly");
      },
      closed: Promise.resolve(),
    };

    const [failErr] = await concurrentAll(client, [
      (c) => stream(c),
      (c) => socket(c),
      // Negative isClosableSession shapes to verify every guard condition.
      () => Promise.resolve([null, undefined] as const),
      () => Promise.resolve([null, null] as const),
      () => Promise.resolve([null, {}] as const),
      () => Promise.resolve([null, { close: "not-a-fn" }] as const),
      () => Promise.resolve([null, { close() {} }] as const),
      () =>
        Promise.resolve([
          null,
          { close() {}, closed: "not-a-promise" },
        ] as const),
      () => Promise.resolve([null, throwingHandle] as const),
      (c) => getOrder(c, { id: 1 }),
    ]);
    expect(failErr?.code).toBe("HTTP_STATUS");
    expect(closedHandles).toBe(1);
    await vi.waitFor(() =>
      expect(fakeWs.last().closeCalls.length).toBeGreaterThanOrEqual(1),
    );
    // Close SSE controller cleanly for worker teardown.
    for (const c of sseControllers) {
      try {
        c.close();
      } catch {
        // Already closed by stream abort.
      }
    }

    // concurrentAllSettled with open WS session retains signals until closed.
    const settledCtrl = new AbortController();
    const [settledWs] = await concurrentAllSettled(client, [(c) => socket(c)], {
      signal: settledCtrl.signal,
    });
    expect(settledWs[0]).toBeNull();
    if (settledWs[0] === null) {
      settledCtrl.abort("close settled");
      await expect(settledWs[1].closed).resolves.toMatchObject({
        kind: "aborted",
      });
    }
  });

  test("uncaught throws rollback opened handles and reject cleanly in concurrentAll & concurrentAllSettled", async () => {
    const fakeWs = createFakeWebSocket({ handshake: "auto" });
    const socket = defineWebSocket({
      path: "/ws",
      incoming: struct.object({ msg: struct.string() }),
    });
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withWebSocketHandle(fakeWs.Socket),
    );

    const errA = new Error("uncaught-a");
    const errB = new Error("uncaught-b");
    const openGate = Promise.withResolvers<void>();
    const throwGate = Promise.withResolvers<void>();

    await expect(
      concurrentAll(client, [
        async (c) => {
          const opened = await socket(c);
          openGate.resolve();
          return opened;
        },
        async () => {
          await openGate.promise;
          throw errA;
        },
        async () => {
          await openGate.promise;
          await Promise.resolve();
          throw errB;
        },
      ]),
    ).rejects.toBe(errA);

    await vi.waitFor(() =>
      expect(fakeWs.last().closeCalls.length).toBeGreaterThanOrEqual(1),
    );

    // concurrentAllSettled with concurrency: 2 and 4 items hitting both double-throw and loop exit on uncaughtError.
    const sOpenGate = Promise.withResolvers<void>();
    let skippedCalled = false;
    await expect(
      concurrentAllSettled(
        client,
        [
          async (c) => {
            const opened = await socket(c);
            sOpenGate.resolve();
            await throwGate.promise;
            return opened;
          },
          async () => {
            await sOpenGate.promise;
            throwGate.resolve();
            throw errA;
          },
          () => {
            skippedCalled = true;
            return Promise.reject(errB);
          },
          () => Promise.resolve([null, "fourth"] as const),
        ],
        { concurrency: 2 },
      ),
    ).rejects.toBe(errA);
    expect(skippedCalled).toBe(false);

    // Simultaneous uncaught throw in two workers inside concurrentAllSettled covers second-throw ignore branch.
    await expect(
      concurrentAllSettled(client, [
        () => Promise.reject(errA),
        () => Promise.reject(errB),
      ]),
    ).rejects.toBe(errA);
  });
});
