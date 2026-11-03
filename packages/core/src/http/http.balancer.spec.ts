import { setImmediate } from "node:timers/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { describe, expect, test } from "vitest";
import type {
  EndpointBalancer,
  EndpointDoneInfo,
  EndpointPickInfo,
  EndpointPickOutcome,
} from "../balancer";
import { ERR_NO_ENDPOINT, pickFirstBalancer } from "../balancer";
import {
  createClient,
  withEndpoint,
  withEndpointBalancer,
  withEndpointFailover,
  withHTTPHandle,
  withInterceptors,
} from "../client";
import { ERR_FETCH_UNSUPPORTED } from "../client/config";
import { ERR_TIMEOUT } from "../error";
import { createHttpInterceptor } from "../interceptor";
import { makeResponse } from "../internal/http_response";
import { struct } from "../struct";
import { defineRequest } from "./index";
import { ERR_STREAMING_REQUEST_UNSUPPORTED } from "./transport/fetch";

type Probe = {
  hits: string[];
  url: string;
  close: () => Promise<void>;
};

function serve(
  respond: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Probe> {
  const hits: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    respond(req, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected a TCP port"));
        return;
      }
      resolve({
        hits,
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            for (const socket of sockets) {
              socket.destroy();
            }
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

async function closedOrigins(count: number): Promise<string[]> {
  // Hold every port at once so two closed origins cannot be the same string,
  // then drop them. Later servers are already listening and will not reuse them.
  const held = await Promise.all(
    Array.from({ length: count }, () => serve(() => undefined)),
  );
  const urls = held.map((probe) => probe.url);
  await Promise.all(held.map((probe) => probe.close()));
  return urls;
}

function watch(inner: EndpointBalancer) {
  const picks: EndpointPickInfo[] = [];
  const dones: EndpointDoneInfo[] = [];
  const balancer: EndpointBalancer = {
    pick(info) {
      picks.push(info);
      const outcome = inner.pick(info);
      if (outcome[0] !== null) {
        return outcome;
      }
      const selected = outcome[1];
      return [
        null,
        {
          endpoint: selected.endpoint,
          done(report) {
            dones.push(report);
            selected.done?.(report);
          },
        },
      ];
    },
  };
  return { balancer, dones, picks };
}

const get = defineRequest({ method: "GET", path: "/" });

async function using(probes: Probe[], run: () => Promise<void>) {
  try {
    await run();
  } finally {
    await Promise.all(probes.map((probe) => probe.close()));
  }
}

describe("HTTP endpoint balancer", () => {
  test("advances pickFirstBalancer on the next call after a refused connection", async () => {
    const live = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const [dead] = await closedOrigins(1);
    if (dead === undefined) {
      throw new Error("expected a closed origin");
    }
    await using([live], async () => {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint(dead, live.url),
        withEndpointFailover({ attempts: 0 }),
        withEndpointBalancer(watched.balancer),
      );

      const [first] = await get(client);
      const [second] = await get(client);

      expect(first?.code).toBe("NET_UNREACHABLE");
      expect(second).toBeNull();
      expect(live.hits).toEqual(["/"]);
      expect(watched.dones[0]).toEqual({
        attempted: true,
        code: "NET_UNREACHABLE",
      });
      expect(watched.picks.map((info) => info.endpoints[0])).toEqual([
        dead,
        dead,
      ]);
      expect(watched.picks[1]?.endpoints[1]).toBe(live.url);
    });
  });

  test("does not advance pickFirstBalancer after an HTTP 500", async () => {
    const primary = await serve((_req, res) => {
      res.writeHead(500);
      res.end("down");
    });
    const backup = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await using([primary, backup], async () => {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint(primary.url, backup.url),
        withEndpointBalancer(watched.balancer),
      );

      const [first] = await get(client);
      const [second] = await get(client);

      expect(first?.code).toBe("HTTP_STATUS");
      expect(second?.code).toBe("HTTP_STATUS");
      expect(primary.hits).toEqual(["/", "/"]);
      expect(backup.hits).toEqual([]);
      expect(watched.dones).toEqual([
        { attempted: true, status: 500 },
        { attempted: true, status: 500 },
      ]);
    });
  });

  test("does not advance pickFirstBalancer after NET_TIMEOUT", async () => {
    const hang = await serve(() => undefined);
    const backup = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await using([hang, backup], async () => {
      let trap = false;
      const seen: string[] = [];
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint(hang.url, backup.url),
        withEndpointBalancer(watched.balancer),
        withInterceptors(
          createHttpInterceptor(async (request, next) => {
            if (!trap) {
              return next(request);
            }
            seen.push(request.baseEndpoint ?? "");
            return makeResponse({ status: 204 });
          }),
        ),
      );

      const [timedOut] = await get(
        client({ signal: AbortSignal.timeout(500) }),
      );
      trap = true;
      const [nextCall] = await get(client);

      expect(timedOut?.code).toBe("NET_TIMEOUT");
      expect(nextCall).toBeNull();
      expect(seen).toEqual([hang.url]);
      expect(backup.hits).toEqual([]);
      expect(watched.dones[0]).toEqual({
        attempted: true,
        code: "NET_TIMEOUT",
      });
    });
  }, 10_000);

  test("advances pickFirstBalancer only one endpoint when overlapping calls fail", async () => {
    const live = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const [firstDead, secondDead] = await closedOrigins(2);
    if (firstDead === undefined || secondDead === undefined) {
      throw new Error("expected two closed origins");
    }
    await using([live], async () => {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint(firstDead, secondDead, live.url),
        withEndpointFailover({ attempts: 0 }),
        withEndpointBalancer(watched.balancer),
      );

      const [left, right] = await Promise.all([get(client), get(client)]);
      const [third] = await get(client);
      const [fourth] = await get(client);

      expect(left[0]?.code).toBe("NET_UNREACHABLE");
      expect(right[0]?.code).toBe("NET_UNREACHABLE");
      expect(third?.code).toBe("NET_UNREACHABLE");
      expect(fourth).toBeNull();
      expect(live.hits).toEqual(["/"]);
      expect(watched.dones.slice(0, 2)).toEqual([
        { attempted: true, code: "NET_UNREACHABLE" },
        { attempted: true, code: "NET_UNREACHABLE" },
      ]);
    });
  });

  test("returns REQ_BUILD_FAILED with the thrown pick cause and does not throw", async () => {
    const reason = { why: "pick" };
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer({
        pick() {
          throw reason;
        },
      }),
    );

    await expect(get(client)).resolves.toMatchObject([
      { cause: reason, code: "REQ_BUILD_FAILED" },
      undefined,
      undefined,
    ]);
  });

  test("returns REQ_BUILD_FAILED whose cause is the illegal pick result", async () => {
    // Invalid on purpose: the runtime must keep this value as cause, not wrap it.
    const illegal = { endpoint: 1 };
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer({
        pick: () => illegal as unknown as EndpointPickOutcome,
      }),
    );

    const [fault] = await get(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(illegal);
  });

  test("returns REQ_OPTIONS_INVALID when the balancer reports an option error", async () => {
    const watched = watch(
      pickFirstBalancer({
        shuffle: "yes",
      } as unknown as { readonly shuffle?: boolean }),
    );
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
    );

    const [fault] = await get(client);

    expect(fault?.code).toBe("REQ_OPTIONS_INVALID");
    expect(fault?.cause).toBeInstanceOf(TypeError);
    expect(watched.dones).toEqual([]);
    expect(watched.picks).toHaveLength(1);
  });

  test("returns REQ_BUILD_FAILED with ERR_NO_ENDPOINT when no endpoint is configured", async () => {
    const watched = watch(pickFirstBalancer());
    const client = createClient(withEndpointBalancer(watched.balancer));

    const [fault] = await get(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(ERR_NO_ENDPOINT);
    expect(watched.dones).toEqual([]);
  });

  test("reports attempted false when makeResponse copies fields without calling next", async () => {
    const live = await serve((_req, res) => {
      res.writeHead(503);
      res.end();
    });
    await using([live], async () => {
      const watched = watch(pickFirstBalancer());
      const copied = {
        body: { down: true },
        headers: new Headers({ "content-type": "application/json" }),
        status: 503,
        statusText: "Service Unavailable",
        url: `${live.url}/down`,
      };
      const client = createClient(
        withEndpoint(live.url),
        withEndpointBalancer(watched.balancer),
        withInterceptors(
          createHttpInterceptor(() => Promise.resolve(makeResponse(copied))),
        ),
      );

      const [fault] = await get(client);

      expect(fault?.code).toBe("HTTP_STATUS");
      expect(live.hits).toEqual([]);
      expect(watched.dones).toEqual([{ attempted: false }]);
    });
  });

  test("reports only the status when declared decoding fails and does not advance pick_first", async () => {
    const primary = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "nope" }));
    });
    const backup = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await using([primary, backup], async () => {
      const watched = watch(pickFirstBalancer());
      const read = defineRequest({
        method: "GET",
        output: struct.object({ id: struct.number() }),
        path: "/",
      });
      const client = createClient(
        withEndpoint(primary.url, backup.url),
        withEndpointBalancer(watched.balancer),
      );

      const [first] = await read(client);
      const [second] = await read(client);

      expect(first?.code).toBe("RES_STRUCT_MISMATCH");
      expect(second?.code).toBe("RES_STRUCT_MISMATCH");
      expect(primary.hits).toEqual(["/", "/"]);
      expect(backup.hits).toEqual([]);
      expect(watched.dones).toEqual([
        { attempted: true, status: 200 },
        { attempted: true, status: 200 },
      ]);
    });
  });

  test("reports only the status when the response media type is wrong", async () => {
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.object({ id: struct.number() }),
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
      withHTTPHandle(() =>
        Promise.resolve(
          new Response("nope", {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
        ),
      ),
    );

    const [fault] = await read(client);

    expect(fault?.code).toBe("RES_MEDIA_TYPE_INVALID");
    expect(watched.dones).toEqual([{ attempted: true, status: 200 }]);
  });

  test("reports only the status when response JSON fails to parse", async () => {
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.object({ id: struct.number() }),
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
      withHTTPHandle(() =>
        Promise.resolve(
          new Response("not-json", {
            headers: { "content-type": "application/json" },
            status: 201,
          }),
        ),
      ),
    );

    const [fault] = await read(client);

    expect(fault?.code).toBe("RES_DECODE_FAILED");
    expect(watched.dones).toEqual([{ attempted: true, status: 201 }]);
  });

  test("calls done once when the builder throws", async () => {
    const reason = { why: "build" };
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      builder: () => {
        throw reason;
      },
      input: struct.object({}),
      method: "GET",
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
    );

    const [fault] = await read(client, {});

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(reason);
    expect(watched.picks).toHaveLength(1);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("calls done once when the caller aborts before next", async () => {
    const watched = watch(pickFirstBalancer());
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const controller = new AbortController();
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(
          () =>
            new Promise(() => {
              markReady();
            }),
        ),
      ),
    );

    const pending = get(client({ signal: controller.signal }));
    await ready;
    controller.abort();

    const [fault] = await pending;
    expect(fault?.code).toBe("NET_ABORTED");
    expect(watched.picks).toHaveLength(1);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("does not pick when the caller already aborted", async () => {
    const watched = watch(pickFirstBalancer());
    const controller = new AbortController();
    controller.abort();
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
    );

    const [fault] = await get(client({ signal: controller.signal }));

    expect(fault?.code).toBe("NET_ABORTED");
    expect(watched.picks).toEqual([]);
    expect(watched.dones).toEqual([]);
  });

  test("reports attempted false when next is rejected before fetch", async () => {
    const live = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await using([live], async () => {
      const watched = watch(pickFirstBalancer());
      const controller = new AbortController();
      const client = createClient(
        withEndpoint(live.url),
        withEndpointBalancer(watched.balancer),
        withInterceptors(
          createHttpInterceptor(async (request, next) => {
            controller.abort();
            return next(request);
          }),
        ),
      );

      const [fault] = await get(client({ signal: controller.signal }));

      expect(fault?.code).toBe("NET_ABORTED");
      expect(live.hits).toEqual([]);
      expect(watched.dones).toEqual([{ attempted: false }]);
    });
  });

  test("reports attempted false when the deadline is already due before fetch", async () => {
    const watched = watch(pickFirstBalancer());
    const controller = new AbortController();
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          controller.abort(ERR_TIMEOUT);
          return next(request);
        }),
      ),
    );

    const [fault] = await get(client({ signal: controller.signal }));

    expect(fault?.code).toBe("NET_TIMEOUT");
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("drops a recorded status when the call ends as NET_TIMEOUT", async () => {
    const live = await serve((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await using([live], async () => {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint(live.url, "https://backup.example"),
        withEndpointBalancer(watched.balancer),
        withInterceptors(
          createHttpInterceptor(async (request, next) => {
            await next(request);
            throw ERR_TIMEOUT;
          }),
        ),
      );

      const [fault] = await get(client);
      const [again] = await get(client);

      expect(fault?.code).toBe("NET_TIMEOUT");
      expect(again?.code).toBe("NET_TIMEOUT");
      expect(live.hits).toEqual(["/", "/"]);
      expect(watched.dones).toEqual([
        { attempted: true, code: "NET_TIMEOUT" },
        { attempted: true, code: "NET_TIMEOUT" },
      ]);
    });
  });

  test("calls done once when an interceptor short-circuits", async () => {
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(makeResponse({ status: 204 })),
        ),
      ),
    );

    const [fault] = await get(client);

    expect(fault).toBeNull();
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("reports attempted false when an interceptor replaces baseEndpoint", async () => {
    const primary = await serve((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    const backup = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await using([primary, backup], async () => {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint(primary.url, backup.url),
        withEndpointBalancer(watched.balancer),
        withInterceptors(
          createHttpInterceptor((request, next) =>
            next({ ...request, baseEndpoint: backup.url }),
          ),
        ),
      );

      const [fault] = await get(client);

      expect(fault).toBeNull();
      expect(primary.hits).toEqual([]);
      expect(backup.hits).toEqual(["/"]);
      expect(watched.picks[0]).toMatchObject({
        endpoints: [primary.url, backup.url],
        transport: "http",
      });
      expect(watched.dones).toEqual([{ attempted: false }]);
    });
  });

  test("passes transport http and the definition operation to every pick", async () => {
    const live = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await using([live], async () => {
      const watched = watch(pickFirstBalancer());
      const named = defineRequest({
        method: "GET",
        operation: "loadOrder",
        path: "/orders",
      });
      const plain = defineRequest({ method: "GET", path: "/health" });
      const client = createClient(
        withEndpoint(live.url, "https://backup.example"),
        withEndpointBalancer(watched.balancer),
      );

      await named(client);
      await plain(client);

      expect(watched.picks[0]).toMatchObject({
        endpoints: [live.url, "https://backup.example"],
        operation: "loadOrder",
        transport: "http",
      });
      expect(watched.picks[1]).toMatchObject({
        operation: undefined,
        transport: "http",
      });
    });
  });

  test("reports NET_BODY_INCOMPLETE with the response status", async () => {
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.string(),
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
      withHTTPHandle(() => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("cut"));
          },
        });
        return Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
        );
      }),
    );

    const [fault] = await read(client);

    expect(fault?.code).toBe("NET_BODY_INCOMPLETE");
    expect(watched.dones).toEqual([
      {
        attempted: true,
        code: "NET_BODY_INCOMPLETE",
        status: 200,
      },
    ]);
  });

  test("reports only the status when a download observer fails after the response", async () => {
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.string(),
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
      withHTTPHandle(() =>
        Promise.resolve(
          new Response("hello", {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
        ),
      ),
    );

    const [fault] = await read(
      client({
        onDownloadProgress() {
          throw new Error("watch");
        },
      }),
    );

    expect(fault?.code).toBe("EXT_OBSERVER_FAILED");
    expect(watched.dones).toEqual([{ attempted: true, status: 200 }]);
  });

  test("reports attempted false when an upload observer fails before the response", async () => {
    let fetched = false;
    const watched = watch(pickFirstBalancer());
    const send = defineRequest({
      builder: () => ({ body: new Blob(["hello"]) }),
      method: "POST",
      path: "/up",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(watched.balancer),
      withHTTPHandle(() => {
        fetched = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );

    const [fault] = await send(
      client({
        onUploadProgress() {
          throw new Error("watch");
        },
      }),
    );

    expect(fault?.code).toBe("EXT_OBSERVER_FAILED");
    expect(fetched).toBe(false);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("reports attempted false for fetch and streaming sentinels", async () => {
    const cases = [
      ERR_FETCH_UNSUPPORTED,
      ERR_STREAMING_REQUEST_UNSUPPORTED,
    ] as const;
    for (const sentinel of cases) {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint("https://example.com"),
        withEndpointBalancer(watched.balancer),
        withHTTPHandle(() => {
          throw sentinel;
        }),
      );

      const [fault] = await get(client);

      expect(fault?.code).toBe("ENV_UNSUPPORTED");
      expect(fault?.cause).toBe(sentinel);
      expect(watched.dones).toEqual([{ attempted: false }]);
    }
  });

  test("keeps the last matching next when an earlier one settles later", async () => {
    let pending = 0;
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const live = await serve((_req, res) => {
      pending += 1;
      if (pending === 1) {
        void gate.then(() => {
          res.writeHead(500);
          res.end();
        });
        return;
      }
      res.writeHead(200);
      res.end("ok");
    });
    await using([live], async () => {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint(live.url),
        withEndpointBalancer(watched.balancer),
        withInterceptors(
          createHttpInterceptor(async (request, next) => {
            const first = next(request);
            const second = await next(request);
            openGate();
            await first;
            return second;
          }),
        ),
      );

      const [fault] = await get(client);

      expect(fault).toBeNull();
      expect(watched.picks).toHaveLength(1);
      expect(watched.dones).toEqual([{ attempted: true, status: 200 }]);
    });
  });

  test("reports attempted false when the selected endpoint URL cannot be resolved", async () => {
    const live = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await using([live], async () => {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint(live.url),
        withEndpointBalancer(watched.balancer),
        withInterceptors(
          createHttpInterceptor((request, next) =>
            next({ ...request, endpoint: "http://[" }),
          ),
        ),
      );

      const [fault] = await get(client);

      expect(fault?.code).toBe("REQ_BUILD_FAILED");
      expect(live.hits).toEqual([]);
      expect(watched.dones).toEqual([{ attempted: false }]);
    });
  });

  test("returns a build-failure tuple when the picked endpoint getter throws", async () => {
    const cause = new Error("endpoint getter");
    const client = createClient(
      withEndpointBalancer({
        pick: () => [
          null,
          {
            get endpoint(): string {
              throw cause;
            },
          },
        ],
      }),
    );

    const [fault] = await get(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(cause);
  });

  test("keeps the successful operation tuple when async done rejects", async () => {
    const live = await serve((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await using([live], async () => {
      const reports: EndpointDoneInfo[] = [];
      const client = createClient(
        withEndpoint(live.url),
        withEndpointBalancer({
          pick: () => [
            null,
            {
              endpoint: live.url,
              async done(report) {
                reports.push(report);
                throw new Error("HTTP async done rejection");
              },
            },
          ],
        }),
      );

      const [fault] = await get(client);
      expect(fault).toBeNull();
      expect(live.hits).toHaveLength(1);
      expect(reports).toEqual([{ attempted: true, status: 204 }]);
      // Give unhandled rejections a turn to reach Vitest's process listener.
      await setImmediate();
    });
  });

  test("still returns the tuple when done throws", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer({
        pick: () => [
          null,
          {
            endpoint: "https://example.com",
            done() {
              throw new Error("done blew up");
            },
          },
        ],
      }),
      withHTTPHandle(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      ),
    );

    const [fault] = await get(client);

    expect(fault).toBeNull();
  });
});
