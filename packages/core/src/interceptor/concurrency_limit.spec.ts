import { afterEach, describe, expect, test, vi } from "vitest";
import { pickFirstBalancer } from "../balancer";
import type { Balancer, DoneInfo, PickInfo } from "../balancer";
import {
  createClient,
  withBalancer,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
} from "../client";
import { ERR_ABORTED, ERR_TIMEOUT } from "../error";
import { defineRequest } from "../http";
import type { HttpRequest, HttpResponse } from "../http";
import { makeResponse } from "../http";
import { makeFakeHandler } from "../../test/make_fake_handler";
import { struct } from "../struct";
import {
  BulkheadOverflowError,
  concurrencyLimitHttpInterceptor,
} from "./concurrency_limit";
import { makeChain } from "./interceptor";

describe("concurrencyLimitHttpInterceptor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("validates maxConcurrency and maxQueue eagerly at creation", () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        concurrencyLimitHttpInterceptor({ maxConcurrency: invalid }),
      ).toThrow(RangeError);
    }

    for (const invalidQueue of [-1, 1.5, Number.NaN]) {
      expect(() =>
        concurrencyLimitHttpInterceptor({
          maxConcurrency: 1,
          maxQueue: invalidQueue,
        }),
      ).toThrow(RangeError);
    }

    expect(() =>
      concurrencyLimitHttpInterceptor({ maxConcurrency: 1, maxQueue: 0 }),
    ).not.toThrow();
    expect(() =>
      concurrencyLimitHttpInterceptor({
        maxConcurrency: 2,
        maxQueue: Number.POSITIVE_INFINITY,
      }),
    ).not.toThrow();
  });

  test("snapshots options at factory creation", async () => {
    const options = {
      maxConcurrency: 1,
      maxQueue: 0,
      key: () => "first",
    };
    const interceptor = concurrencyLimitHttpInterceptor(options);
    options.maxConcurrency = 5;
    options.maxQueue = 5;
    options.key = () => "second";

    const gate = Promise.withResolvers<HttpResponse<unknown>>();
    let calls = 0;
    const chain = makeChain([interceptor.fn]);
    const next = () => {
      calls += 1;
      if (calls === 1) return gate.promise;
      return Promise.resolve(
        makeResponse({ url: "https://example.test", status: 200 }),
      );
    };

    const req: HttpRequest = {
      baseEndpoint: "https://example.test",
      endpoint: "/items",
      method: "GET",
    };

    const first = chain(req, next);
    await expect(chain(req, next)).rejects.toMatchObject({
      name: "BulkheadOverflowError",
      key: "first",
      maxConcurrency: 1,
      maxQueue: 0,
    });

    gate.resolve(makeResponse({ url: "https://example.test", status: 200 }));
    await expect(first).resolves.toMatchObject({ status: 200 });
  });

  test("enforces maxConcurrency, preserves FIFO order, and releases permits on reject", async () => {
    const interceptor = concurrencyLimitHttpInterceptor({ maxConcurrency: 2 });
    const chain = makeChain([interceptor.fn]);
    const started: string[] = [];
    const deferred = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<HttpResponse<unknown>>>
    >();
    let currentInFlight = 0;
    let peakInFlight = 0;

    const sendReq = (id: string) =>
      chain(
        {
          baseEndpoint: "https://example.test",
          endpoint: `/items/${id}`,
          method: "GET",
        },
        (req) => {
          started.push(id);
          currentInFlight += 1;
          peakInFlight = Math.max(peakInFlight, currentInFlight);
          const gate = Promise.withResolvers<HttpResponse<unknown>>();
          deferred.set(req.endpoint, gate);
          return gate.promise.finally(() => {
            currentInFlight -= 1;
          });
        },
      );

    const p0 = sendReq("0");
    const p1 = sendReq("1");
    const p2 = sendReq("2");
    const p3 = sendReq("3");

    expect(started).toEqual(["0", "1"]);
    expect(peakInFlight).toBe(2);

    deferred
      .get("/items/0")
      ?.resolve(
        makeResponse({ url: "https://example.test/items/0", status: 200 }),
      );
    await p0;
    await Promise.resolve();
    expect(started).toEqual(["0", "1", "2"]);

    const failure = new Error("downstream boom");
    deferred.get("/items/1")?.reject(failure);
    await expect(p1).rejects.toBe(failure);
    await Promise.resolve();
    expect(started).toEqual(["0", "1", "2", "3"]);
    expect(peakInFlight).toBe(2);

    deferred
      .get("/items/2")
      ?.resolve(
        makeResponse({ url: "https://example.test/items/2", status: 200 }),
      );
    deferred
      .get("/items/3")
      ?.resolve(
        makeResponse({ url: "https://example.test/items/3", status: 200 }),
      );

    await expect(p2).resolves.toMatchObject({ status: 200 });
    await expect(p3).resolves.toMatchObject({ status: 200 });
    expect(currentInFlight).toBe(0);

    // Subsequent call after bucket drain works cleanly.
    const p4 = chain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/items/4",
        method: "GET",
      },
      makeFakeHandler({ response: { status: 204 } }),
    );
    await expect(p4).resolves.toMatchObject({ status: 204 });
  });

  test("partitions permits by key(req), populates req.baseEndpoint, and surfaces key() throws as EXT_INTERCEPTOR_FAILED", async () => {
    const getItems = defineRequest({
      method: "GET",
      path: "/items/:id",
      input: struct.object({ id: struct.string() }),
      builder: ({ id }) => ({ path: { id } }),
      output: struct.object({ id: struct.string() }),
    });

    const gates = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<Response>>
    >();
    const observedKeys: Array<string | undefined> = [];

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withInterceptors(
        concurrencyLimitHttpInterceptor({
          maxConcurrency: 1,
          maxQueue: 0,
          key: (req) => {
            observedKeys.push(req.baseEndpoint);
            return `${req.baseEndpoint ?? ""}:${req.endpoint}`;
          },
        }),
      ),
      withHTTPHandle((input) => {
        const url = input instanceof Request ? input.url : String(input);
        const gate = Promise.withResolvers<Response>();
        gates.set(new URL(url).pathname, gate);
        return gate.promise;
      }),
    );

    const a = getItems(client, { id: "a" });
    const b = getItems(client, { id: "b" });

    // Distinct keys do not block each other.
    await vi.waitFor(() => expect(gates.has("/items/a")).toBe(true));
    await vi.waitFor(() => expect(gates.has("/items/b")).toBe(true));
    expect(observedKeys).toEqual([
      "https://api.example.test",
      "https://api.example.test",
    ]);

    // Same key overflows immediately because maxQueue is 0.
    const [overflowErr] = await getItems(client, { id: "a" });
    expect(overflowErr?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(overflowErr?.cause).toBeInstanceOf(BulkheadOverflowError);
    if (overflowErr?.cause instanceof BulkheadOverflowError) {
      expect(overflowErr.cause.key).toBe("https://api.example.test:/items/a");
      expect(overflowErr.cause.message).toContain(
        'for "https://api.example.test:/items/a"',
      );
      expect(overflowErr.cause.maxConcurrency).toBe(1);
      expect(overflowErr.cause.maxQueue).toBe(0);
    }

    gates.get("/items/a")?.resolve(Response.json({ id: "a" }, { status: 200 }));
    gates.get("/items/b")?.resolve(Response.json({ id: "b" }, { status: 200 }));
    await expect(a).resolves.toEqual([
      null,
      { id: "a" },
      expect.objectContaining({ status: 200 }),
    ]);
    await expect(b).resolves.toEqual([
      null,
      { id: "b" },
      expect.objectContaining({ status: 200 }),
    ]);

    const keyBoom = new Error("key selector failed");
    const brokenClient = createClient(
      withEndpoint("https://api.example.test"),
      withInterceptors(
        concurrencyLimitHttpInterceptor({
          maxConcurrency: 1,
          key: () => {
            throw keyBoom;
          },
        }),
      ),
      withHTTPHandle(() => Promise.resolve(Response.json({ id: "x" }))),
    );
    const [keyErr] = await getItems(brokenClient, { id: "x" });
    expect(keyErr?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(keyErr?.cause).toBe(keyBoom);
  });

  test("overflow fails with EXT_INTERCEPTOR_FAILED + BulkheadOverflowError, skips retry, and reports attempted: false", async () => {
    const doneReports: DoneInfo[] = [];
    const inner = pickFirstBalancer();
    const spyBalancer: Balancer = {
      pick(info: PickInfo) {
        const result = inner.pick(info);
        if (result[0] !== null) return result;
        const picked = result[1];
        return [
          null,
          {
            ...picked,
            done(doneInfo) {
              doneReports.push(doneInfo);
              picked.done?.(doneInfo);
            },
          },
        ];
      },
    };

    const ping = defineRequest({ method: "GET", path: "/ping" });
    const firstGate = Promise.withResolvers<Response>();
    const secondGate = Promise.withResolvers<Response>();
    let fetchCalls = 0;

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withBalancer(spyBalancer),
      withRetry({ maxRetries: 2, methods: ["GET"], delayMs: 1 }),
      withInterceptors(
        concurrencyLimitHttpInterceptor({
          maxConcurrency: 1,
          maxQueue: 1,
        }),
      ),
      withHTTPHandle(() => {
        fetchCalls += 1;
        return fetchCalls === 1 ? firstGate.promise : secondGate.promise;
      }),
    );

    const active = ping(client);
    await vi.waitFor(() => expect(fetchCalls).toBe(1));

    const queued = ping(client);

    // 3rd call exceeds maxQueue: 1 -> BulkheadOverflowError (empty default key branch)
    const [overflowErr, data, res] = await ping(client);
    expect(data).toBeUndefined();
    expect(res).toBeUndefined();
    expect(overflowErr?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(overflowErr?.cause).toBeInstanceOf(BulkheadOverflowError);
    if (overflowErr?.cause instanceof BulkheadOverflowError) {
      expect(overflowErr.cause.key).toBe("");
      expect(overflowErr.cause.message).toBe(
        "Concurrency limit reached (maxConcurrency: 1, maxQueue: 1)",
      );
      expect(overflowErr.cause.maxConcurrency).toBe(1);
      expect(overflowErr.cause.maxQueue).toBe(1);
    }
    expect(fetchCalls).toBe(1);
    expect(doneReports).toEqual([{ attempted: false }]);

    firstGate.resolve(new Response(null, { status: 200 }));
    await active;
    secondGate.resolve(new Response(null, { status: 200 }));
    await queued;
  });

  test("handles pre-aborted signals, mid-queue evictions, swapped unbranded signals, and missing req.signal", async () => {
    const keyCalls: string[] = [];
    const interceptor = concurrencyLimitHttpInterceptor({
      maxConcurrency: 1,
      key: (req) => {
        keyCalls.push(req.endpoint);
        return "shared";
      },
    });
    const ping = defineRequest({ method: "GET", path: "/ping" });

    const preAborted = new AbortController();
    preAborted.abort("stop");
    const preTimedOut = new AbortController();
    preTimedOut.abort(new DOMException("deadline", "TimeoutError"));

    const activeGate = Promise.withResolvers<Response>();
    let handleCalls = 0;

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withInterceptors(interceptor),
      withHTTPHandle(() => {
        handleCalls += 1;
        if (handleCalls === 1) return activeGate.promise;
        return Promise.resolve(new Response(null, { status: 200 }));
      }),
    );

    const [preErr] = await ping(client({ signal: preAborted.signal }));
    expect(preErr?.code).toBe("NET_ABORTED");
    expect(keyCalls).toEqual([]);

    const [preTimeoutErr] = await ping(client({ signal: preTimedOut.signal }));
    expect(preTimeoutErr?.code).toBe("NET_TIMEOUT");
    expect(keyCalls).toEqual([]);

    // Also test when an outer interceptor swaps in an already-aborted signal so concurrency_limit itself guards preflight entry.
    await expect(
      interceptor.fn(
        {
          baseEndpoint: "https://api.example.test",
          endpoint: "/pre-aborted",
          method: "GET",
          signal: preAborted.signal,
        },
        makeFakeHandler({ response: { status: 200 } }),
      ),
    ).rejects.toBe(ERR_ABORTED);
    await expect(
      interceptor.fn(
        {
          baseEndpoint: "https://api.example.test",
          endpoint: "/pre-timed-out",
          method: "GET",
          signal: preTimedOut.signal,
        },
        makeFakeHandler({ response: { status: 200 } }),
      ),
    ).rejects.toBe(ERR_TIMEOUT);
    expect(keyCalls).toEqual([]);

    // Occupy the single permit.
    const activeCall = ping(client);
    await vi.waitFor(() => expect(handleCalls).toBe(1));

    // Queue waiter A (manual abort), waiter B (timeout abort), waiter C (stays queued).
    const ctrlA = new AbortController();
    const ctrlB = new AbortController();
    const waiterA = ping(client({ signal: ctrlA.signal }));
    const waiterB = ping(client({ signal: ctrlB.signal }));
    const waiterC = ping(client);

    // Direct chain call without req.signal while queue is non-empty covers signal === undefined branch.
    const noSignalPromise = interceptor.fn(
      {
        baseEndpoint: "https://api.example.test",
        endpoint: "/direct",
        method: "GET",
      },
      makeFakeHandler({ response: { status: 201 } }),
    );

    ctrlA.abort("user cancelled");
    ctrlB.abort(ERR_TIMEOUT);

    const [errA] = await waiterA;
    const [errB] = await waiterB;
    expect(errA?.code).toBe("NET_ABORTED");
    expect(errB?.code).toBe("NET_TIMEOUT");

    // Outer interceptor swaps req.signal to its own unbranded abort reason; must map to NET_ABORTED / NET_TIMEOUT.
    const swappedCtrl = new AbortController();
    const swappedClient = createClient(
      withEndpoint("https://api.example.test"),
      withInterceptors(
        {
          kind: "http",
          fn(req, next) {
            return next({ ...req, signal: swappedCtrl.signal });
          },
        },
        interceptor,
      ),
      withHTTPHandle(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      ),
    );
    const swappedCall = ping(swappedClient);
    swappedCtrl.abort(new Error("unbranded custom reason"));
    const [swappedErr] = await swappedCall;
    expect(swappedErr?.code).toBe("NET_ABORTED");
    expect(swappedErr?.cause).toBe(ERR_ABORTED);

    activeGate.resolve(new Response(null, { status: 200 }));
    const [activeResErr] = await activeCall;
    const [cErr, , cRes] = await waiterC;
    const noSignalRes = await noSignalPromise;

    expect(activeResErr).toBeNull();
    expect(cErr).toBeNull();
    expect(cRes?.status).toBe(200);
    expect(noSignalRes.status).toBe(201);
  });

  test("releases permits during withRetry backoff wait to avoid deadlocks", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    const ping = defineRequest({
      method: "GET",
      path: "/items/:id",
      input: struct.object({ id: struct.string() }),
      builder: ({ id }) => ({ path: { id } }),
    });
    const attempts: string[] = [];
    const retryReady = Promise.withResolvers<void>();

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withRetry({
        maxRetries: 1,
        delayMs: 1000,
        jitter: 0,
        methods: ["GET"],
      }),
      withInterceptors(concurrencyLimitHttpInterceptor({ maxConcurrency: 1 })),
      withHTTPHandle((input) => {
        const url = input instanceof Request ? input.url : String(input);
        const path = new URL(url).pathname;
        attempts.push(path);
        if (
          path === "/items/slow" &&
          attempts.filter((p) => p === "/items/slow").length === 1
        ) {
          queueMicrotask(() => retryReady.resolve());
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      }),
    );

    const slowCall = ping(client, { id: "slow" });
    await retryReady.promise;
    await vi.advanceTimersByTimeAsync(0);

    // slowCall is sleeping in backoff timer; its permit must have been released so fastCall succeeds right away.
    const [fastErr, , fastRes] = await ping(client, { id: "fast" });
    expect(fastErr).toBeNull();
    expect(fastRes?.status).toBe(200);

    await vi.advanceTimersByTimeAsync(1000);
    const [slowErr, , slowRes] = await slowCall;
    expect(slowErr).toBeNull();
    expect(slowRes?.status).toBe(200);
    expect(attempts).toEqual(["/items/slow", "/items/fast", "/items/slow"]);
  });
});
