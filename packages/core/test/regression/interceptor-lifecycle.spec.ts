import { expect, test, vi } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  makeResponse,
  struct,
  type WebSocketConnectionInfo,
  type WebSocketSessionLike,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
  withWebSocketHandle,
} from "../../src";
import { createFakeWebSocket } from "../fake_web_socket";
import { yieldMacrotask } from "../macrotask";

const socketEndpoint = defineWebSocket({
  path: "/socket",
  incoming: struct.unknown(),
});

test.each([
  { transformed: false, reconnect: false },
  { transformed: false, reconnect: true },
  { transformed: true, reconnect: false },
  { transformed: true, reconnect: true },
])(
  "WebSocket tuple respects wrapper metadata with transformed=$transformed and reconnect=$reconnect",
  async ({ transformed, reconnect }) => {
    const fake = createFakeWebSocket();
    const readConnection = vi.fn((connection: WebSocketConnectionInfo) =>
      transformed
        ? { ...connection, url: "wss://public.example/socket" }
        : connection,
    );
    let inner: WebSocketSessionLike | undefined;
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(fake.Socket),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          const session = await next({
            ...request,
            query: new URLSearchParams({ ticket: "private-value" }),
          });
          inner = session;
          if (reconnect) {
            const first = fake.sockets[0];
            if (!first) throw new Error("Expected the first physical socket");
            first.peerClose(1012, "restart");
            await vi.waitFor(() =>
              expect(session.connection.generation).toBe(2),
            );
          }
          return new Proxy(session, {
            get(target, key) {
              if (key === "connection")
                return readConnection(target.connection);
              const value: unknown = Reflect.get(target, key, target);
              return value;
            },
          });
        }),
      ),
    );
    try {
      const [fault, session, snapshot] = await socketEndpoint(
        client({ retry: { maxRetries: 1, delayMs: 0 } }),
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
      expect(fake.sockets.at(-1)?.readyState).toBe(1);
    } finally {
      inner?.close();
      await inner?.closed;
      for (const socket of fake.sockets) socket.close();
    }
  },
);

test("WebSocket physical open does not cancel on its own while caller abort remains active", async () => {
  vi.useFakeTimers();
  const fake = createFakeWebSocket();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const controller = new AbortController();
  const client = createClient(
    withEndpoint("https://example.test"),
    withWebSocketHandle(fake.Socket),
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
  const pending = socketEndpoint(client({ signal: controller.signal })).then(
    (result) => {
      settled = true;
      return result;
    },
  );
  try {
    await entered.promise;
    await vi.advanceTimersByTimeAsync(101);
    // No startup deadline remains after the socket opens. Only the caller signal can cancel it.
    expect(settled).toBe(false);
    controller.abort("stop post-open interceptor");
    const [fault, session] = await pending;
    expect(fault?.code).toBe("NET_ABORTED");
    expect(session).toBeUndefined();
    expect(fake.sockets[0]?.readyState).toBe(3);
  } finally {
    controller.abort("cleanup");
    release.resolve();
    await pending;
    for (const socket of fake.sockets) socket.close();
    vi.useRealTimers();
  }
});

test("WebSocket respects an already-aborted signal supplied by an interceptor", async () => {
  const fake = createFakeWebSocket();
  const client = createClient(
    withEndpoint("https://example.test"),
    withWebSocketHandle(fake.Socket),
    withInterceptors(
      createWebSocketInterceptor((request, next) =>
        next({ ...request, signal: AbortSignal.abort("stop") }),
      ),
    ),
  );
  const [fault, session] = await socketEndpoint(client);
  try {
    expect(fault?.code).toBe("NET_ABORTED");
    expect(session).toBeUndefined();
    expect(fake.sockets).toHaveLength(0);
  } finally {
    session?.close();
    for (const socket of fake.sockets) socket.close();
  }
});

test("HTTP honours both the caller signal and an interceptor replacement signal", async () => {
  const endpoint = defineRequest({ method: "GET", path: "/hang" });
  const calls: number[] = [];
  const blocked = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(() => {
      calls.push(1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
    withInterceptors(
      createHttpInterceptor((request, next) =>
        next({ ...request, signal: AbortSignal.abort("stop") }),
      ),
    ),
  );
  const [blockedFault] = await endpoint(blocked);
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
          next({ ...request, signal: replacement.signal }),
        ),
      ),
    );
    const pending = endpoint(client({ signal: caller.signal }));
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

/** Runs `run`, then returns every promise rejection the runtime reported as unhandled while it ran. */
async function collectUnhandledRejections(
  run: () => Promise<void>,
): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const sentinel = new Error("flush unhandled rejections");
  const flushed = Promise.withResolvers<void>();
  const record = (reason: unknown) => {
    if (reason === sentinel) flushed.resolve();
    else reasons.push(reason);
  };
  // Reports arrive in order, so the sentinel's proves that every earlier one has. The macrotask lets the
  // rejections that `run` caused settle first.
  const flush = async () => {
    await yieldMacrotask();
    void Promise.reject(sentinel);
    await flushed.promise;
  };
  if (typeof window === "undefined") {
    // Vitest's own listeners would report the sentinel as well, so they sit out the collection.
    const inherited = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", record);
    try {
      await run();
      await flush();
    } finally {
      process.off("unhandledRejection", record);
      for (const listener of inherited) {
        process.on("unhandledRejection", listener);
      }
    }
    return reasons;
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    record(event.reason);
  };
  // Vitest's own listener logs each event once a test registers one of its own.
  const silence = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  window.addEventListener("unhandledrejection", onRejection);
  try {
    await run();
    await flush();
  } finally {
    window.removeEventListener("unhandledrejection", onRejection);
    silence.mockRestore();
  }
  return reasons;
}

test("HTTP lets an interceptor drop next() without an unhandled rejection", async () => {
  const endpoint = defineRequest({ method: "GET", path: "/dropped" });
  const sent = Promise.withResolvers<void>();
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(() => {
      sent.resolve();
      return new Promise(() => undefined);
    }),
    withInterceptors(
      createHttpInterceptor(async (request, next) => {
        void next(request);
        await sent.promise;
        return makeResponse({ status: 200, request });
      }),
    ),
  );
  let fault: unknown;
  const unhandled = await collectUnhandledRejections(async () => {
    [fault] = await endpoint(client);
  });
  expect(fault).toBeNull();
  expect(unhandled).toEqual([]);
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
        next({ ...request, signal: replacement.signal }),
      ),
    ),
    withSSEHandle((request) => {
      transportSignal = new Request(request).signal;
      return Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }),
  );
  const endpoint = defineEventStream({
    path: "/events",
    events: { message: struct.string() },
  });
  const [fault, stream] = await endpoint(client({ signal: controller.signal }));
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
