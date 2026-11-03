import { afterEach, expect, inject, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  defineEventStream,
  defineWebSocket,
  withEndpoint,
  withEndpointBalancer,
  withHTTPHandle,
  withSSEHandle,
  withSSEReconnect,
  withWebSocketHandle,
  withEndpointFailover,
  withInterceptors,
  struct,
  ERR_TIMEOUT,
} from "../src";
import type {
  EndpointBalancer,
  EndpointDoneInfo,
  WebSocketHandleConstructor,
} from "../src";
import { createControllableSocketClass } from "./regression/controllable_socket";
import { makeResponse } from "../src/internal/http_response";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function recorder() {
  const events: string[] = [];
  const ends: EndpointDoneInfo[] = [];
  const b: EndpointBalancer = {
    pick({ endpoints }) {
      return [
        null,
        {
          endpoint: endpoints[0] ?? "",
          start() {
            events.push("start");
          },
          end(info) {
            events.push("end");
            ends.push(info);
          },
          done() {
            events.push("done");
          },
        },
      ];
    },
  };
  return { b, events, ends };
}
test("HTTP end is synchronous at response headers before body decoding or post-interceptors", async () => {
  const h = recorder();
  let release = () => {};
  const ready = Promise.withResolvers<void>();
  const client = createClient(
    withEndpoint("https://test.invalid"),
    withEndpointBalancer(h.b),
    withHTTPHandle(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              release = () => {
                c.enqueue(new TextEncoder().encode("ok"));
                c.close();
              };
            },
          }),
        ),
    ),
    withInterceptors({
      kind: "http",
      async fn(req, next) {
        const response = await next(req);
        expect(h.events).toEqual(["start", "end"]);
        return response;
      },
    }),
  );
  // Observe the callback itself: no sleep or body-completion race.
  const end = h.b.pick.bind(h.b);
  h.b.pick = (info) => {
    const [e, p] = end(info);
    if (e) return [e, undefined];
    return [
      null,
      {
        ...p,
        end(report) {
          p.end?.(report);
          ready.resolve();
        },
      },
    ];
  };
  const pending = defineRequest({
    method: "GET",
    path: "/",
    output: struct.string(),
  })(client);
  await ready.promise;
  expect(h.events).toEqual(["start", "end"]);
  expect(h.ends).toEqual([{ attempted: true, status: 200 }]);
  release();
  expect((await pending)[1]).toBe("ok");
  expect(h.events).toEqual(["start", "end", "done"]);
});
test.each(["failure", "cancel", "timeout"])(
  "HTTP %s emits end once with phase-2a attribution",
  async (mode) => {
    const h = recorder();
    const controller = new AbortController();
    const client = createClient(
      withEndpoint("https://test.invalid"),
      withEndpointBalancer(h.b),
      withEndpointFailover({ attempts: 0 }),
      withHTTPHandle(async () => {
        if (mode === "failure") throw new TypeError("refused");
        controller.abort(mode === "timeout" ? ERR_TIMEOUT : undefined);
        throw controller.signal.reason;
      }),
    );
    await defineRequest({ method: "GET", path: "/" })(
      client({ signal: controller.signal }),
    );
    expect(h.events).toEqual(["start", "end", "done"]);
    expect(h.ends).toEqual([
      mode === "cancel"
        ? { attempted: false }
        : {
            attempted: true,
            code: mode === "timeout" ? "NET_TIMEOUT" : "NET_UNREACHABLE",
          },
    ]);
  },
);
test.each(["builder", "short-circuit", "makeResponse"])(
  "HTTP %s does not emit end",
  async (mode) => {
    const h = recorder();
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withEndpointBalancer(h.b),
      withInterceptors({
        kind: "http",
        fn: () => Promise.resolve(makeResponse({ status: 204 })),
      }),
    );
    await defineRequest({
      method: "GET",
      path: "/json",
      builder: () => {
        if (mode === "builder") throw new Error("build");
        return {};
      },
    })(client);
    expect(h.events).toEqual(["done"]);
    expect(h.ends).toEqual([]);
    const live = createClient(
      withEndpoint(inject("testServerHost")),
      withEndpointBalancer(h.b),
    );
    await defineRequest({ method: "GET", path: "/json" })(live);
    expect(h.events).toEqual(["done", "start", "end", "done"]);
  },
);
test("SSE end occurs at handshake while the real event stream remains open", async () => {
  const h = recorder();
  const host = inject("testServerHost");
  const client = createClient(withEndpoint(host), withEndpointBalancer(h.b));
  const [error, stream] = await defineEventStream({
    path: "/sse/infinite",
    events: { tick: struct.string() },
  })(client);
  expect(error).toBeNull();
  if (!stream) throw new Error("stream");
  try {
    await stream[Symbol.asyncIterator]().next();
    expect(h.events).toEqual(["start", "end"]);
    expect(h.ends).toEqual([{ attempted: true, status: 200 }]);
  } finally {
    await stream[Symbol.asyncDispose]();
  }
  expect(h.events).toEqual(["start", "end", "done"]);
});
test.each(["failure", "cancel", "timeout"])(
  "SSE %s before headers ends once",
  async (mode) => {
    const h = recorder();
    const controller = new AbortController();
    const client = createClient(
      withEndpoint("https://test.invalid"),
      withEndpointBalancer(h.b),
      withSSEHandle(async () => {
        if (mode === "failure") throw new TypeError("refused");
        controller.abort(mode === "timeout" ? ERR_TIMEOUT : undefined);
        throw controller.signal.reason;
      }),
    );
    await defineEventStream({ path: "/", events: { tick: struct.string() } })(
      client({ signal: controller.signal }),
    );
    expect(h.events).toEqual(["start", "end", "done"]);
    expect(h.ends).toEqual([
      mode === "cancel"
        ? { attempted: false }
        : {
            attempted: true,
            code: mode === "timeout" ? "NET_TIMEOUT" : "NET_UNREACHABLE",
          },
    ]);
  },
);
test("WebSocket end occurs on open while the real session remains open", async () => {
  const h = recorder();
  const client = createClient(
    withEndpoint(inject("testServerHost")),
    withEndpointBalancer(h.b),
  );
  const [error, session] = await defineWebSocket({
    path: "/ws/basic",
    incoming: struct.unknown(),
    maxIncomingQueueSize: 4,
  })(client);
  expect(error).toBeNull();
  if (!session) throw new Error("session");
  try {
    expect(h.events).toEqual(["start", "end"]);
    expect(h.ends).toEqual([{ attempted: true }]);
  } finally {
    await session[Symbol.asyncDispose]();
  }
  expect(h.events).toEqual(["start", "end", "done"]);
});
test("WebSocket constructor failure ends before done", async () => {
  const h = recorder();
  class Broken extends WebSocket {
    constructor(url: string | URL) {
      super(url);
      this.close();
      throw new Error("constructor");
    }
  }
  const client = createClient(
    withEndpoint(inject("testServerHost")),
    withEndpointBalancer(h.b),
    withWebSocketHandle(Broken),
  );
  await defineWebSocket({
    path: "/ws/basic",
    incoming: struct.unknown(),
    maxIncomingQueueSize: 4,
  })(client);
  expect(h.events).toEqual(["start", "end", "done"]);
  expect(h.ends).toEqual([{ attempted: true, code: "NET_UNREACHABLE" }]);
});

// Coverage-only: a failed transport belonging to an interceptor-replaced base.
test("a replaced base failing before headers never ends the selected endpoint", async () => {
  const h = recorder();
  const client = createClient(
    withEndpoint("https://first.test"),
    withEndpointBalancer(h.b),
    withHTTPHandle(async () => {
      throw new TypeError("refused");
    }),
    withInterceptors({
      kind: "http",
      fn: (req, next) =>
        next({ ...req, baseEndpoint: "https://replacement.test" }),
    }),
  );
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0]?.code,
  ).toBe("NET_UNREACHABLE");
  expect(h.events).toEqual(["done"]);
  expect(h.ends).toEqual([]);
});

test.each(["failure", "cancel", "caller-timeout", "handshake-timeout"])(
  "WebSocket pre-open %s emits its transport end once",
  async (mode) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { Socket, latest } = createControllableSocketClass();
    const controller = new AbortController();
    const h = recorder();
    const client = createClient(
      withEndpoint("https://socket.test"),
      withEndpointBalancer(h.b),
      // The controllable fixture implements listeners; its narrow interface omits them.
      withWebSocketHandle(Socket as unknown as WebSocketHandleConstructor),
    );
    const pending = defineWebSocket({
      path: "/",
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
    })(
      client({
        signal: controller.signal,
        reconnect: { attempts: 0, connectTimeoutMs: 100 },
      }),
    );
    await vi.waitFor(() => expect(latest()).toBeDefined());
    if (mode === "failure")
      latest()?.triggerClose({ code: 1006, reason: "", wasClean: false });
    else if (mode === "handshake-timeout")
      await vi.advanceTimersByTimeAsync(100);
    else controller.abort(mode === "caller-timeout" ? ERR_TIMEOUT : undefined);
    await pending;
    expect(h.events).toEqual(["start", "end", "done"]);
    expect(h.ends).toEqual([
      mode === "cancel"
        ? { attempted: false }
        : {
            attempted: true,
            code: mode === "caller-timeout" ? "NET_TIMEOUT" : "NET_UNREACHABLE",
          },
    ]);
  },
);

test("SSE handshake timeout ends as unreachable while the operation reports timeout", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const h = recorder();
  let fetched = false;
  const client = createClient(
    withEndpoint("https://sse.test"),
    withEndpointBalancer(h.b),
    withSSEReconnect({ attempts: 0, connectTimeoutMs: 100 }),
    withSSEHandle(async () => {
      fetched = true;
      return new Promise<Response>(() => {});
    }),
  );
  const pending = defineEventStream({
    path: "/",
    events: { tick: struct.string() },
  })(client);
  await vi.waitFor(() => expect(fetched).toBe(true));
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
  expect(h.events).toEqual(["start", "end", "done"]);
  expect(h.ends).toEqual([{ attempted: true, code: "NET_UNREACHABLE" }]);
});
