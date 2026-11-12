import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint, withInterceptors } from "../client";
import { ERR_ABORTED } from "../error";
import { createWebSocketInterceptor } from "../interceptor";
import { struct } from "../struct";
import { defineWebSocket } from "./index";
import {
  useFakeClock,
  lastMockInstance,
  mockInstances,
  createMockWebSocketClass,
  createDeferred,
  expectOnlyErrorSink,
  run,
} from "../../test/mock_web_socket";

describe("web socket startup with a mock handle", () => {
  test("should preserve a pre-aborted timeout without constructing a physical socket", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    controller.abort(new DOMException("deadline expired", "TimeoutError"));
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      { signal: controller.signal },
    );

    expect(error).toMatchObject({
      code: "NET_TIMEOUT",
      message: "Request timed out",
    });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should treat a plain timeout-message Error abort reason as an abort", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    controller.abort(new Error("Request timed out"));
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      { signal: controller.signal },
    );

    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should return transport error when WebSocket constructor throws", async () => {
    const refusal = new SyntaxError("Wrong protocol for WebSocket");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        throwOnConstruct: refusal,
      }),
    );

    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket, connection] = await run(client, useSocket);

    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    // A constructor refusal (invalid subprotocol, unsupported scheme) is not checked by the library: it is
    // reported as an unreachable endpoint with the constructor's error as the cause, as the errors guide states.
    expect(error?.code).toBe("NET_UNREACHABLE");
    expect(error?.cause).toBe(refusal);
  });

  test("should return transport error when WebSocket constructor throws non-Error", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        throwOnConstruct: "connection refused",
      }),
    );

    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket, connection] = await run(client, useSocket);

    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(error?.code).toBe("NET_UNREACHABLE");
    expect(error?.message).toBe("connection refused");
  });

  test("should finish startup with aborted transport error when aborted before open", async () => {
    const listening = createDeferred<void>();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        autoOpen: false,
        onListenerRegistered(type) {
          if (type === "open") {
            listening.resolve(undefined);
          }
        },
      }),
    );

    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const executePromise = run(client, useSocket, {
      signal: controller.signal,
    });

    await listening.promise;
    controller.abort(ERR_ABORTED);

    const [error, socket, connection] = await executePromise;

    expect(socket).toBeUndefined();
    expect(connection?.url).toBe("ws://localhost/ws/test");
    expect(error?.code.startsWith("NET_")).toBe(true);
    expect(error?.code).toBe("NET_ABORTED");
  });

  test("should snapshot configured protocols before beforeConnect mutates their source", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const protocols = ["snapshot-protocol"];
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        beforeConnect() {
          protocols[0] = "mutated-protocol";
        },
        protocols,
      },
    );

    expect(error).toBeNull();
    expect(lastMockInstance?.protocol).toBe("snapshot-protocol");
    socket?.close(1000, "done");
    await socket?.closed;
  });

  test("should not construct a physical socket when abort follows transport handler invocation", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const abortingInterceptor = createWebSocketInterceptor((request, next) => {
      const pendingSession = next(request);
      controller.abort(ERR_ABORTED);
      return pendingSession;
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
    expect(mockInstances).toHaveLength(0);
  });

  test("should prefer an abort that follows a pre-open close in the same turn", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerClose({
      code: 1006,
      reason: "early close",
      wasClean: false,
    });
    controller.abort(ERR_ABORTED);

    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toMatchObject({ generation: 0 });
  });

  test("should report a transport error when the peer closes before open without a native cause", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerClose({
      code: 1006,
      reason: "early close",
      wasClean: false,
    });

    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({
      code: "NET_UNREACHABLE",
      message: "WebSocket closed before open",
    });
    expect(socket).toBeUndefined();
    expect(connection).toMatchObject({ generation: 0 });
  });

  test("should report a missing WebSocket constructor as an environment fault", async () => {
    vi.stubGlobal("WebSocket", undefined);

    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket, connection] = await run(client, useSocket);

    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(error?.code).toBe("ENV_UNSUPPORTED");
  });

  test("should set duplicate open state only once", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));

    const states: string[] = [];
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    const nativeSocket = lastMockInstance;
    nativeSocket?.triggerOpen();
    const [, socket] = await executePromise;

    if (!socket || !nativeSocket) {
      throw new Error("Expected socket");
    }

    socket.onStateChange((state: string) => {
      states.push(state);
    });
    nativeSocket.triggerOpen();
    nativeSocket.triggerOpen();

    // The listener is attached after the session is already open, so the first open is not
    // observable. Duplicate open events on that live session must not emit more open states.
    expect(states.filter((state) => state === "open")).toHaveLength(0);
    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should set binaryType to arraybuffer on socket creation", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoCloseDelay: 50 }),
    );

    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [, socket] = await run(client, useSocket);

    expect(socket).toBeDefined();
    expect(lastMockInstance?.binaryType).toBe("arraybuffer");
  });

  test("cleans the physical socket when its constructor aborts before listener registration", async () => {
    useFakeClock();
    const controller = new AbortController();
    const BaseSocket = createMockWebSocketClass({ autoOpen: false });
    class AbortingSocket extends BaseSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        controller.abort(ERR_ABORTED);
      }
    }
    vi.stubGlobal("WebSocket", AbortingSocket);
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, session] = await run(
      createClient(withEndpoint("http://localhost")),
      endpoint,
      { signal: controller.signal },
    );
    const nativeSocket = lastMockInstance;
    if (!nativeSocket) throw new Error("Expected physical socket");
    expect(error?.code).toBe("NET_ABORTED");
    expect(session).toBeUndefined();
    expect(nativeSocket.close).toHaveBeenCalledOnce();
    expectOnlyErrorSink(nativeSocket);
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("ignores a late error after a connecting attempt was cancelled", async () => {
    useFakeClock();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const controller = new AbortController();
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const pending = run(
      createClient(withEndpoint("http://localhost")),
      endpoint,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    const nativeSocket = lastMockInstance;
    if (!nativeSocket) throw new Error("Expected physical socket");
    controller.abort(ERR_ABORTED);
    const [error, session] = await pending;

    expect(error?.code).toBe("NET_ABORTED");
    expect(session).toBeUndefined();
    expect(nativeSocket.close).toHaveBeenCalledOnce();
    // Closing a CONNECTING socket makes `ws` emit this error afterwards, and it throws when
    // the error has no listener.
    expect(() => nativeSocket.triggerError()).not.toThrow();
    expectOnlyErrorSink(nativeSocket);
    await vi.runAllTimersAsync();
    expect(mockInstances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should abort-race beforeConnect and consume its late rejection", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const contexts: Array<{ attempt: number; signal: AbortSignal }> = [];
    let rejectHook: ((reason: unknown) => void) | undefined;
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        beforeConnect(context: { attempt: number; signal: AbortSignal }) {
          contexts.push(context);
          return new Promise<void>((_resolve, reject) => {
            rejectHook = reject;
          });
        },
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    controller.abort(ERR_ABORTED);
    const result = await executePromise;

    expect(contexts[0]?.attempt).toBe(0);
    expect(contexts[0]?.signal.aborted).toBe(true);
    expect(lastMockInstance).toBeUndefined();
    expect(result[0]).toMatchObject({ code: "NET_ABORTED" });

    rejectHook?.(new Error("late hook rejection"));
    await Promise.resolve();
    await Promise.resolve();
  });
});
