import { expect, test, vi } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  type WebSocketConnectionInfo,
  type WebSocketSessionLike,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
  withWebSocketHandle,
} from "../../src";

function socketHarness() {
  const instances: Socket[] = [];
  class Socket extends EventTarget {
    static readonly OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    protocol = "";
    extensions = "";
    binaryType = "blob";
    readonly url: string;
    constructor(url: string | URL) {
      super();
      this.url = String(url);
      instances.push(this);
      void Promise.resolve().then(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send(_data: string) {}
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
  }
  return { instances, Socket };
}

const socketEndpoint = defineWebSocket({
  path: "/socket",
  incoming: struct.unknown(),
  maxIncomingQueueSize: 4,
});

test.each([
  { transformed: false, reconnect: false },
  { transformed: false, reconnect: true },
  { transformed: true, reconnect: false },
  { transformed: true, reconnect: true },
])(
  "WebSocket tuple respects wrapper metadata with transformed=$transformed and reconnect=$reconnect",
  async ({ transformed, reconnect }) => {
    const { instances, Socket } = socketHarness();
    const readConnection = vi.fn((connection: WebSocketConnectionInfo) =>
      transformed
        ? { ...connection, url: "wss://public.example/socket" }
        : connection,
    );
    let inner: WebSocketSessionLike | undefined;
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(Socket),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          const session = await next({
            ...request,
            queryString: "ticket=private-value",
          });
          inner = session;
          if (reconnect) {
            const first = instances[0];
            if (!first) throw new Error("Expected the first physical socket");
            first.readyState = 3;
            first.dispatchEvent(
              Object.assign(new Event("close"), {
                code: 1012,
                reason: "restart",
                wasClean: true,
              }),
            );
            await vi.waitFor(() =>
              expect(session.connection.generation).toBe(2),
            );
          }
          return new Proxy(session, {
            get(target, key) {
              return key === "connection"
                ? readConnection(target.connection)
                : Reflect.get(target, key, target);
            },
          });
        }),
      ),
    );
    try {
      const [fault, session, snapshot] = await client.execute(
        socketEndpoint(),
        {
          reconnect: { attempts: 1, delayMs: 0 },
        },
      );
      expect(fault).toBeNull();
      expect(readConnection).toHaveBeenCalledOnce();
      expect(snapshot?.url).toBe(
        transformed
          ? "wss://public.example/socket"
          : "wss://example.test/socket?ticket=private-value",
      );
      expect(snapshot?.generation).toBe(transformed && reconnect ? 2 : 1);
      if (transformed)
        expect(snapshot).toBe(readConnection.mock.results[0]?.value);
      expect(session?.state).toBe("open");
      expect(instances.at(-1)?.readyState).toBe(1);
    } finally {
      inner?.close();
      await inner?.closed;
      for (const socket of instances) socket.close();
    }
  },
);

test("WebSocket physical open releases the startup deadline while caller abort remains active", async () => {
  vi.useFakeTimers();
  const { instances, Socket } = socketHarness();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const controller = new AbortController();
  const client = createClient(
    withEndpoint("https://example.test"),
    withWebSocketHandle(Socket),
    withInterceptors(
      createWebSocketInterceptor(async (request, next) => {
        const session = await next(request);
        entered.resolve();
        await release.promise;
        return session;
      }),
    ),
  );
  let settled = false;
  const pending = client
    .execute(socketEndpoint(), { timeout: 100, signal: controller.signal })
    .then((result) => {
      settled = true;
      return result;
    });
  try {
    await entered.promise;
    await vi.advanceTimersByTimeAsync(101);
    // The existing reconnect audit requires the startup timeout to end at first physical open.
    expect(settled).toBe(false);
    controller.abort("stop post-open interceptor");
    const [fault, session] = await pending;
    expect(fault?.code).toBe("NET_ABORTED");
    expect(session).toBeUndefined();
    expect(instances[0]?.readyState).toBe(3);
  } finally {
    controller.abort("cleanup");
    release.resolve();
    await pending;
    for (const socket of instances) socket.close();
    vi.useRealTimers();
  }
});

test("WebSocket respects an already-aborted signal supplied by an interceptor", async () => {
  const { instances, Socket } = socketHarness();
  const client = createClient(
    withEndpoint("https://example.test"),
    withWebSocketHandle(Socket),
    withInterceptors(
      createWebSocketInterceptor((request, next) =>
        next({ ...request, abort: AbortSignal.abort("stop") }),
      ),
    ),
  );
  const [fault, session] = await client.execute(socketEndpoint());
  try {
    expect(fault?.code).toBe("NET_ABORTED");
    expect(session).toBeUndefined();
    expect(instances).toHaveLength(0);
  } finally {
    session?.close();
    for (const socket of instances) socket.close();
  }
});

test("HTTP honours both the caller signal and an interceptor replacement signal", async () => {
  const endpoint = defineRequest({ method: "GET", path: "/hang" });
  const calls: number[] = [];
  const blocked = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async () => {
      calls.push(1);
      return new Response(null, { status: 204 });
    }),
    withInterceptors(
      createHttpInterceptor((request, next) =>
        next({ ...request, abort: AbortSignal.abort("stop") }),
      ),
    ),
  );
  const [blockedFault] = await blocked.execute(endpoint());
  expect(blockedFault?.code).toBe("NET_ABORTED");
  expect(calls).toEqual([]);

  for (const mode of ["caller", "interceptor"] as const) {
    const caller = new AbortController();
    const replacement = new AbortController();
    const started = Promise.withResolvers<AbortSignal>();
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle((request) => {
        started.resolve(new Request(request).signal);
        return new Promise(() => undefined);
      }),
      withInterceptors(
        createHttpInterceptor((request, next) =>
          next({ ...request, abort: replacement.signal }),
        ),
      ),
    );
    const pending = client.execute(endpoint(), { signal: caller.signal });
    const transportSignal = await started.promise;
    if (mode === "caller") caller.abort("caller stopped");
    else replacement.abort("interceptor stopped");
    expect({ mode, aborted: transportSignal.aborted }).toEqual({
      mode,
      aborted: true,
    });
    const [fault] = await pending;
    expect({ mode, code: fault?.code }).toEqual({ mode, code: "NET_ABORTED" });
  }
});

test("SSE keeps caller cancellation after an interceptor supplies its own signal", async () => {
  const controller = new AbortController();
  const replacement = new AbortController();
  const started = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const cancel = vi.fn(() => cancelled.resolve());
  let transportSignal: AbortSignal | undefined;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        started.resolve();
        return new Promise<void>(() => undefined);
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const client = createClient(
    withEndpoint("https://example.test"),
    withInterceptors(
      createSSEInterceptor((request, next) =>
        next({ ...request, abort: replacement.signal }),
      ),
    ),
    withSSEHandle(async (request) => {
      transportSignal = new Request(request).signal;
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    }),
  );
  const endpoint = defineEventStream({
    path: "/events",
    events: { message: struct.string() },
    maxBufferSize: 1024,
    maxQueueSize: 4,
  });
  const [fault, stream] = await client.execute(endpoint(), {
    signal: controller.signal,
  });
  try {
    expect(fault).toBeNull();
    await started.promise;
    controller.abort("caller stopped");
    expect(transportSignal?.aborted).toBe(true);
    await cancelled.promise;
    expect(cancel).toHaveBeenCalledOnce();
    expect((await stream?.closed)?.kind).toBe("aborted");
  } finally {
    stream?.close("cleanup");
    replacement.abort("cleanup");
    await stream?.closed;
  }
});
