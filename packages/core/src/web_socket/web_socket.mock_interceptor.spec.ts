import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint, withInterceptors } from "../client";
import { ERR_ABORTED } from "../error";
import {
  createWebSocketInterceptor,
  type WebSocketSessionLike,
} from "../interceptor";
import { struct } from "../struct";
import { defineWebSocket } from "./index";
import { openSession, stubFakeWebSocket } from "../../test/fake_web_socket";
import { createDeferred, run } from "../../test/web_socket_support";

describe("web socket interceptors with a mock handle", () => {
  test("should observe an abort issued by an interceptor before the transport handler starts", async () => {
    const fake = stubFakeWebSocket();
    const controller = new AbortController();
    const abortingInterceptor = createWebSocketInterceptor((request, next) => {
      controller.abort(ERR_ABORTED);
      return next(request);
    });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(abortingInterceptor),
      ),
      useSocket,
      { signal: controller.signal },
    );

    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(fake.sockets).toHaveLength(0);
  });

  test("should settle a hanging websocket interceptor when externally aborted", async () => {
    const fake = stubFakeWebSocket();
    const controller = new AbortController();
    const entered = createDeferred<void>();
    const hangingInterceptor = createWebSocketInterceptor(() => {
      entered.resolve(undefined);
      return new Promise<WebSocketSessionLike>(() => undefined);
    });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(hangingInterceptor),
      ),
      useSocket,
      {
        signal: controller.signal,
      },
    );

    await entered.promise;
    controller.abort(ERR_ABORTED);
    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(fake.sockets).toHaveLength(0);
  });

  test("should keep the success tuple on generation one when an interceptor returns after reconnect", async () => {
    const fake = stubFakeWebSocket();
    const gate = createDeferred<void>();
    let interceptedSession: WebSocketSessionLike | undefined;
    const delayedInterceptor = createWebSocketInterceptor(
      async (request, next) => {
        interceptedSession = await next(request);
        await gate.promise;
        return interceptedSession;
      },
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(delayedInterceptor),
      ),
      useSocket,
      {
        retry: { maxRetries: 1, delayMs: 0 },
      },
    );

    await vi.waitFor(() =>
      expect(interceptedSession?.connection.generation).toBe(1),
    );
    const firstSocket = fake.last();
    if (!firstSocket) {
      throw new Error("Expected first socket");
    }
    firstSocket.peerClose(1012, "restart");
    await vi.waitFor(() =>
      expect(interceptedSession?.connection.generation).toBe(2),
    );
    gate.resolve(undefined);

    const [error, socket, startupConnection] = await executePromise;
    expect(error).toBeNull();
    expect(startupConnection?.generation).toBe(1);
    expect(socket?.connection.generation).toBe(2);
    socket?.close(1000, "done");
    await socket?.closed;
  });

  test("should settle a discarded interceptor session when native close never arrives", async () => {
    const fake = stubFakeWebSocket({ handshake: "manual" });
    let discardedSession: WebSocketSessionLike | undefined;
    const replacementSession: WebSocketSessionLike = {
      bufferedAmount: 0,
      close() {},
      closed: Promise.resolve({ kind: "closed" }),
      connection: { generation: 99 },
      onRuntimeError: () => () => {},
      onStateChange: () => () => {},
      receive: {
        async *[Symbol.asyncIterator]() {},
      },
      send() {},
      state: "closed",
      [Symbol.asyncDispose]() {
        this.close();
        return this.closed.then(() => undefined);
      },
    };
    const interceptor = createWebSocketInterceptor(async (request, next) => {
      discardedSession = await next(request);
      return replacementSession;
    });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const { session: socket } = await openSession(
      run(
        createClient(
          withEndpoint("http://localhost"),
          withInterceptors(interceptor),
        ),
        useSocket,
      ),
      fake,
    );
    expect(socket).toBe(replacementSession);
    await expect(discardedSession?.closed).resolves.toMatchObject({
      kind: "aborted",
    });
    expect(fake.last().closeCalls).toHaveLength(1);
  });

  test("should preserve an interceptor error after its created session already settled", async () => {
    const fake = stubFakeWebSocket();
    const interceptorFailure = new Error("interceptor failed after close");
    const interceptor = createWebSocketInterceptor(async (request, next) => {
      const createdSession = await next(request);
      createdSession.close(1000, "interceptor cleanup");
      await createdSession.closed;
      throw interceptorFailure;
    });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(interceptor),
      ),
      useSocket,
    );

    expect(error).toMatchObject({
      cause: interceptorFailure,
      code: "EXT_INTERCEPTOR_FAILED",
    });
    expect(socket).toBeUndefined();
    expect(fake.last().closeCalls).toHaveLength(1);
  });

  test("should settle a pending fire-and-forget interceptor session after a successful short circuit", async () => {
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const replacementSession: WebSocketSessionLike = {
      bufferedAmount: 0,
      close() {},
      closed: Promise.resolve({ kind: "closed" }),
      connection: { generation: 99 },
      onRuntimeError: () => () => {},
      onStateChange: () => () => {},
      receive: {
        async *[Symbol.asyncIterator]() {},
      },
      send() {},
      state: "closed",
      [Symbol.asyncDispose]() {
        this.close();
        return this.closed.then(() => undefined);
      },
    };
    const interceptor = createWebSocketInterceptor(async (request, next) => {
      void next(request);
      // next() constructs the socket on a later turn. Return only after it exists.
      await vi.waitFor(() => expect(fake.sockets.length).toBeGreaterThan(0));
      return replacementSession;
    });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(interceptor),
      ),
      useSocket,
    );

    expect(error).toBeNull();
    expect(socket).toBe(replacementSession);
    expect(fake.last().closeCalls).toHaveLength(1);
    // Closing a connecting socket fails the connection.
    fake.last().drop();
    await expect(replacementSession.closed).resolves.toMatchObject({
      kind: "closed",
    });
  });

  test("should reject next invoked after a successful interceptor chain settles without constructing a socket", async () => {
    const fake = stubFakeWebSocket();
    const lateCall = createDeferred<unknown>();
    const replacementSession: WebSocketSessionLike = {
      bufferedAmount: 0,
      close() {},
      closed: Promise.resolve({ kind: "closed" }),
      connection: { generation: 99 },
      onRuntimeError: () => () => {},
      onStateChange: () => () => {},
      receive: {
        async *[Symbol.asyncIterator]() {},
      },
      send() {},
      state: "closed",
      [Symbol.asyncDispose]() {
        this.close();
        return this.closed.then(() => undefined);
      },
    };
    let invokeLateNext: (() => void) | undefined;
    const interceptor = createWebSocketInterceptor((request, next) => {
      invokeLateNext = () => {
        void next(request).then(lateCall.resolve, lateCall.resolve);
      };
      return Promise.resolve(replacementSession);
    });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(interceptor),
      ),
      useSocket,
    );
    if (!invokeLateNext) {
      throw new Error("Expected the interceptor to capture next()");
    }
    invokeLateNext();
    const lateOutcome = await lateCall.promise;

    expect(error).toBeNull();
    expect(socket).toBe(replacementSession);
    expect(lateOutcome).toMatchObject({
      message:
        "WebSocket interceptor next() may not be called after the chain settles",
    });
    expect(fake.sockets).toHaveLength(0);
    await expect(replacementSession.closed).resolves.toMatchObject({
      kind: "closed",
    });
  });
});
