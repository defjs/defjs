import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint } from "../client";
import { ERR_ABORTED } from "../error";
import { struct } from "../struct";
import { defineWebSocket } from "./index";
import {
  useFakeClock,
  lastMockInstance,
  mockInstances,
  createMockWebSocketClass,
  soleListener,
  expectInertErrorListener,
  expectOnlyErrorSink,
  expectListenerReleased,
  clientObservingAbortListeners,
  run,
} from "../../test/mock_web_socket";

describe("web socket close and disposal with a mock handle", () => {
  test("should classify a TimeoutError abort after open as a timeout close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const reason = new DOMException("deadline", "TimeoutError");
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      { signal: controller.signal },
    );

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket");
    }
    controller.abort(reason);

    await expect(socket.closed).resolves.toMatchObject({
      cause: reason,
      kind: "error",
    });
    expect(mockInstances[0]?.close).toHaveBeenCalledOnce();
  });

  test("should preserve an external abort triggered by a closing observer", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ emitCloseEvent: false }),
    );
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        signal: controller.signal,
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const states: string[] = [];
    socket.onStateChange((state) => {
      states.push(state);
      if (state === "closing") {
        controller.abort(ERR_ABORTED);
      }
    });

    socket.close(1000, "owner closed");

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    expect(socket.state).toBe("aborted");
    expect(states).toEqual(["closing", "aborted"]);
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
  });

  describe.each(["synchronous", "asynchronous"] as const)(
    "%s native close",
    (closeMode) => {
      test.each(["open", "message", "close", "error"] as const)(
        "cleans all listeners when abort fires during %s registration",
        async (registrationPoint) => {
          useFakeClock();
          const controller = new AbortController();
          let abortedDuringRegistration = false;
          vi.stubGlobal(
            "WebSocket",
            createMockWebSocketClass({
              autoOpen: false,
              onListenerRegistered(type) {
                if (type === registrationPoint && !abortedDuringRegistration) {
                  abortedDuringRegistration = true;
                  const nativeSocket = lastMockInstance;
                  if (!nativeSocket)
                    throw new Error("Expected physical socket");
                  if (closeMode === "synchronous") {
                    nativeSocket.close = vi.fn(() =>
                      nativeSocket.triggerClose({
                        code: 1000,
                        reason: "",
                        wasClean: true,
                      }),
                    );
                  }
                  controller.abort(ERR_ABORTED);
                }
              },
            }),
          );
          const useSocket = defineWebSocket({
            incoming: struct.unknown(),
            path: "/ws/test",
          });

          const [error, socket, connection] = await run(
            createClient(withEndpoint("http://localhost")),
            useSocket,
            { signal: controller.signal, heartbeat: { intervalMs: 20 } },
          );

          expect(abortedDuringRegistration).toBe(true);
          expect(error).toMatchObject({ code: "NET_ABORTED" });
          expect(socket).toBeUndefined();
          expect(connection).toMatchObject({ generation: 0 });
          const nativeSocket = lastMockInstance;
          if (!nativeSocket) throw new Error("Expected physical socket");
          expect(nativeSocket.close).toHaveBeenCalledTimes(1);
          expectOnlyErrorSink(nativeSocket);

          nativeSocket.triggerOpen();
          nativeSocket.triggerMessage("null");
          nativeSocket.triggerError();
          nativeSocket.triggerClose({
            code: 1000,
            reason: "late",
            wasClean: true,
          });
          await vi.runAllTimersAsync();

          expectOnlyErrorSink(nativeSocket);
          expect(nativeSocket.close).toHaveBeenCalledTimes(1);
          expect(mockInstances).toHaveLength(1);
          expect(vi.getTimerCount()).toBe(0);
        },
      );
    },
  );

  test("should surface runtime cause on error event before close", async () => {
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
    const nativeSocket = lastMockInstance;
    nativeSocket?.triggerOpen();
    const [error, socket] = await executePromise;

    expect(error).toBeNull();
    if (!socket || !nativeSocket) {
      throw new Error("Expected socket");
    }

    nativeSocket.triggerError();
    // `handleError` detaches itself before the close event arrives and leaves the no-op sink.
    expect(nativeSocket.close).toHaveBeenCalledOnce();
    expectInertErrorListener(nativeSocket);

    const closed = await socket.closed;
    expect(closed.kind).toBe("error");
    if (closed.kind !== "error") {
      throw new Error("expected an error close");
    }
    expect(closed.cause).toEqual(
      expect.objectContaining({ message: "WebSocket connection error" }),
    );
  });

  test("releases the same message listener reference on reconnect, failure, close, and dispose", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const useSocket = defineWebSocket({
      incoming: struct.object({
        n: struct.number(),
        type: struct.literal("tick"),
      }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      { retry: { maxRetries: 2, delayMs: 0 } },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [error, socket] = await executePromise;
    expect(error).toBeNull();
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const iterator = socket.receive[Symbol.asyncIterator]();
    const opened = [lastMockInstance];
    const messageListeners = [soleListener(lastMockInstance, "message")];
    lastMockInstance.triggerMessage(JSON.stringify({ n: 1, type: "tick" }));
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { n: 1, type: "tick" },
    });
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(1);

    const retire = async (
      index: number,
      how: "reconnect" | "failure",
    ): Promise<void> => {
      const nativeSocket = opened[index];
      const listener = messageListeners[index];
      if (!nativeSocket || !listener) {
        throw new Error("Expected the generation being retired");
      }
      if (how === "failure") {
        nativeSocket.triggerError();
        expect(nativeSocket.listenerRefs("message")).toContain(listener);
      }
      nativeSocket.triggerClose({
        code: how === "failure" ? 1006 : 1012,
        reason: how,
        wasClean: how !== "failure",
      });
      expectListenerReleased(nativeSocket, "message", listener);
      nativeSocket.triggerMessage(JSON.stringify({ n: 99, type: "tick" }));
      await vi.waitFor(() => expect(mockInstances).toHaveLength(index + 2));
      const replacement = mockInstances[index + 1];
      if (!replacement) throw new Error("Expected replacement socket");
      replacement.triggerOpen();
      await vi.waitFor(() =>
        expect(socket.connection.generation).toBe(index + 2),
      );
      const replacementListener = soleListener(replacement, "message");
      expect(replacementListener).not.toBe(listener);
      opened.push(replacement);
      messageListeners.push(replacementListener);
      replacement.triggerMessage(
        JSON.stringify({ n: index + 2, type: "tick" }),
      );
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { n: index + 2, type: "tick" },
      });
    };

    await retire(0, "reconnect");
    await retire(1, "failure");

    const current = opened[2];
    const currentListener = messageListeners[2];
    if (!current || !currentListener) {
      throw new Error("Expected the open generation");
    }
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(3);
    socket.close(1000, "done");
    current.triggerClose({ code: 1000, reason: "done", wasClean: true });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
    expect(socket.state).toBe("closed");
    expect(socket.connection.generation).toBe(3);
    expectListenerReleased(current, "message", currentListener);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    expect(socket.state).toBe("closed");
    for (const nativeSocket of opened) {
      expect(nativeSocket.listenerCount("message")).toBe(0);
    }
  });

  test("releases the open generation's abort listeners when the caller cancels", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const controller = new AbortController();
    const { client, observed } = clientObservingAbortListeners();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(client, useSocket, {
      retry: { maxRetries: 1, delayMs: 0 },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [error, socket] = await executePromise;
    expect(error).toBeNull();
    const abortListeners = observed.current;
    if (!socket || !lastMockInstance || !abortListeners) {
      throw new Error("Expected socket");
    }
    lastMockInstance.triggerClose({
      code: 1012,
      reason: "drop",
      wasClean: true,
    });
    await vi.waitFor(() => expect(mockInstances).toHaveLength(2));
    mockInstances[1]?.triggerOpen();
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    expect(socket.state).toBe("open");
    const generation = abortListeners.listeners();
    expect(generation.length).toBeGreaterThan(0);

    controller.abort(ERR_ABORTED);
    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(socket.connection.generation).toBe(2);
    abortListeners.assertReleased(generation);
  });

  test("releases the open generation's abort listeners when the session is disposed", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const { client, observed } = clientObservingAbortListeners();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(client, useSocket, {
      retry: { maxRetries: 1, delayMs: 0 },
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    const abortListeners = observed.current;
    if (!socket || !lastMockInstance || !abortListeners) {
      throw new Error("Expected socket");
    }
    lastMockInstance.triggerClose({
      code: 1012,
      reason: "drop",
      wasClean: true,
    });
    await vi.waitFor(() => expect(mockInstances).toHaveLength(2));
    mockInstances[1]?.triggerOpen();
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    const generation = abortListeners.listeners();
    expect(socket.state).toBe("open");
    expect(generation.length).toBeGreaterThan(0);

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(socket.state).toBe("closed");
    expect(socket.connection.generation).toBe(2);
    abortListeners.assertReleased(generation);
    for (const nativeSocket of mockInstances) {
      expectOnlyErrorSink(nativeSocket);
    }
  });

  test("should settle an error attempt when native close throws synchronously", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeErrors: [new Error("close failed")] }),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    lastMockInstance.triggerError();

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(socket.state).toBe("error");
    expect(lastMockInstance.close).toHaveBeenCalledTimes(1);
  });

  test("should expose generation and native bufferedAmount", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    lastMockInstance.bufferedAmount = 23;
    expect(connection?.generation).toBe(1);
    expect(socket.connection.generation).toBe(1);
    expect(socket.bufferedAmount).toBe(23);

    socket.close(1000, "done");
    await socket.closed;
    expect(socket.bufferedAmount).toBe(0);
  });

  test.each([1001, 2999, 5000, 3000.5, Number.POSITIVE_INFINITY])(
    "should reject invalid close code %s without changing session state",
    async (code) => {
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const [, socket] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket,
      );
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }

      expect(() => socket.close(code)).toThrow(
        expect.objectContaining({ name: "InvalidAccessError" }),
      );
      expect(socket.state).toBe("open");
      expect(lastMockInstance.close).not.toHaveBeenCalled();

      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should reject a close reason over 123 UTF-8 bytes without changing session state", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    expect(() => socket.close(1000, `${"a".repeat(121)}猫`)).toThrow(
      expect.objectContaining({ name: "SyntaxError" }),
    );
    expect(socket.state).toBe("open");
    expect(lastMockInstance.close).not.toHaveBeenCalled();

    socket.close(1000, "done");
    await socket.closed;
  });

  test("should isolate state and runtime observer failures", async () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    const states: string[] = [];
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((error) => {
      runtimeErrors.push(error);
      throw new Error("runtime observer failed");
    });
    socket.onStateChange(() => {
      throw new Error("state observer failed");
    });
    socket.onStateChange((state) => states.push(state));

    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(states).toEqual(["closing", "closed"]);
    expect(runtimeErrors).toHaveLength(2);
    expect(reported).toHaveLength(2);
  });

  test("should isolate observer failures when the runtime has no reportError hook", async () => {
    vi.stubGlobal("reportError", undefined);
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    socket.onRuntimeError(() => {
      throw new Error("runtime observer failed without reportError");
    });
    socket.onStateChange(() => {
      throw new Error("observer failed without reportError");
    });
    socket.close(1000, "done");

    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(socket.state).toBe("closed");
  });

  test("should release observers and return one no-op unsubscribe after terminal", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    socket.onRuntimeError(vi.fn());
    socket.onStateChange(vi.fn());
    socket.close(1000, "done");
    await socket.closed;

    const unsubscribeRuntime = socket.onRuntimeError(vi.fn());
    const unsubscribeState = socket.onStateChange(vi.fn());

    expect(unsubscribeRuntime).toBe(unsubscribeState);
    expect(unsubscribeRuntime()).toBeUndefined();
  });

  test("should settle the active attempt when abort close cannot produce a close event", async () => {
    const closeFailure = new Error("native close failed");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeErrors: [closeFailure] }),
    );
    const controller = new AbortController();
    const shouldRetry = vi.fn(() => true);
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        retry: { maxRetries: 1, delayMs: 0, shouldRetry },
        signal: controller.signal,
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    controller.abort(ERR_ABORTED);

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    await Promise.resolve();
    expect(lastMockInstance.close).toHaveBeenCalledTimes(1);
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  test("should end the session with an error and rethrow when the native close throws", async () => {
    const firstFailure = new Error("first close failed");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeErrors: [firstFailure] }),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    expect(() => socket.close(3000, "owner close")).toThrow(firstFailure);
    expect(socket.state).toBe("error");
    expect(lastMockInstance.close).toHaveBeenCalledTimes(2);
    expect(() => socket.close(200, "invalid after terminal")).toThrow(
      expect.objectContaining({ name: "InvalidAccessError" }),
    );
    expect(lastMockInstance.close).toHaveBeenCalledTimes(2);
    await expect(socket.closed).resolves.toMatchObject({
      cause: firstFailure,
      kind: "error",
    });
    expect(lastMockInstance.close).toHaveBeenCalledTimes(2);
  });

  test("should settle error after both native close calls throw without a third attempt", async () => {
    const firstFailure = new Error("first close failed");
    const fallbackFailure = new Error("fallback close failed");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        closeErrors: [firstFailure, fallbackFailure],
      }),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;

    expect(() => socket.close(3000, "owner close")).toThrow(firstFailure);
    const closed = await socket.closed;
    expect(closed).toMatchObject({ cause: firstFailure, kind: "error" });
    expect(socket.state).toBe("error");
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expect(() => socket.close(3001, "again")).not.toThrow();
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expect(() => socket.close(200, "invalid after terminal")).toThrow(
      expect.objectContaining({ name: "InvalidAccessError" }),
    );
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);

    const removeEventListener = vi.spyOn(nativeSocket, "removeEventListener");
    nativeSocket.triggerClose({
      code: 1000,
      reason: "late physical close",
      wasClean: true,
    });
    const removeEventListenerCallsAfterClose =
      removeEventListener.mock.calls.length;
    expect(socket.bufferedAmount).toBe(0);
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expectOnlyErrorSink(nativeSocket);

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toBe(closed);
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expect(removeEventListener).toHaveBeenCalledTimes(
      removeEventListenerCallsAfterClose,
    );
    expectOnlyErrorSink(nativeSocket);
  });

  test.each([1000, 3000, 4999])("should accept close code %s", async (code) => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    expect(() => socket.close(code, "accepted")).not.toThrow();
    await expect(socket.closed).resolves.toMatchObject({
      code,
      kind: "closed",
      reason: "accepted",
    });
  });

  test("should accept a 123-byte UTF-8 close reason", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket) {
      throw new Error("Expected socket");
    }
    const reason = `${"a".repeat(120)}猫`;

    expect(() => socket.close(1000, reason)).not.toThrow();
    await expect(socket.closed).resolves.toMatchObject({
      kind: "closed",
      reason,
    });
  });

  test("should cache one disposal promise and wait for native close plus lifecycle teardown", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, closeEventDelayMs: 25 }),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    let firstDispose: PromiseLike<void> | undefined;

    expect(() => {
      firstDispose = socket[Symbol.asyncDispose]();
    }).not.toThrow();
    const secondDispose = socket[Symbol.asyncDispose]();

    expect(firstDispose).toBe(secondDispose);
    expect(nativeSocket.close).not.toHaveBeenCalled();
    let settled = false;
    const disposal = Promise.resolve(firstDispose).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(nativeSocket.listenerCount()).toBeGreaterThan(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(24);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(disposal).resolves.toBeUndefined();

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
    });
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expectOnlyErrorSink(nativeSocket);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    ["Error", new Error("native close failed")],
    ["undefined", undefined],
  ] as const)(
    "should preserve a thrown %s close value over disposal timeout and still clean up",
    async (_label, closeFailure) => {
      useFakeClock();
      vi.stubGlobal(
        "WebSocket",
        createMockWebSocketClass({
          autoOpen: false,
          closeErrors: [closeFailure],
          emitCloseEvent: false,
        }),
      );
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const executePromise = run(
        createClient(withEndpoint("http://localhost")),
        useSocket,
      );

      await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
      lastMockInstance?.triggerOpen();
      const [, socket] = await executePromise;
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }
      const nativeSocket = lastMockInstance;
      const pendingReceive = socket.receive[Symbol.asyncIterator]()
        .next()
        .catch((error: unknown) => error);
      let disposeTask: PromiseLike<void> | undefined;

      expect(() => {
        disposeTask = socket[Symbol.asyncDispose]();
      }).not.toThrow();
      const disposal = Promise.resolve(disposeTask).then(
        () => ({ cause: undefined, status: "resolved" as const }),
        (cause: unknown) => ({ cause, status: "rejected" as const }),
      );
      await Promise.resolve();

      expect(nativeSocket.close).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await disposal;

      expect(result.status).toBe("rejected");
      expect(result.cause).toBe(closeFailure);
      await expect(socket.closed).resolves.toMatchObject({
        cause: closeFailure,
        kind: "error",
      });
      // An error end without a cause rejects readers with an AbortError.
      await expect(pendingReceive).resolves.toEqual(
        closeFailure ?? expect.objectContaining({ name: "AbortError" }),
      );
      expect(socket.state).toBe("error");
      expectOnlyErrorSink(nativeSocket);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test("should release the socket when both native close attempts throw during disposal", async () => {
    const firstFailure = new Error("first close failed");
    const fallbackFailure = new Error("fallback close failed");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        autoOpen: false,
        closeErrors: [firstFailure, fallbackFailure],
        emitCloseEvent: false,
      }),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    nativeSocket.bufferedAmount = 17;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    await expect(Promise.resolve(socket[Symbol.asyncDispose]())).rejects.toBe(
      firstFailure,
    );

    await expect(socket.closed).resolves.toMatchObject({
      cause: firstFailure,
      kind: "error",
    });
    await expect(pendingReceive).resolves.toBe(firstFailure);
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expectOnlyErrorSink(nativeSocket);
    expect(socket.bufferedAmount).toBe(0);
  });

  test("should only await teardown when disposing an already aborted session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const abortCause = new Error("owner aborted");
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      { signal: controller.signal },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    controller.abort(abortCause);
    const terminal = await socket.closed;
    await expect(pendingReceive).resolves.toBe(abortCause);
    const closeCalls = vi.mocked(nativeSocket.close).mock.calls.length;

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toBe(terminal);
    expect(terminal).toMatchObject({ cause: abortCause, kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.close).toHaveBeenCalledTimes(closeCalls);
    expectOnlyErrorSink(nativeSocket);
  });

  test("should only await teardown when disposing an already errored session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    nativeSocket.triggerError();
    const terminal = await socket.closed;
    await expect(pendingReceive).resolves.toMatchObject({
      message: "WebSocket connection error",
    });
    const closeCalls = vi.mocked(nativeSocket.close).mock.calls.length;

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toBe(terminal);
    expect(terminal.kind).toBe("error");
    if (terminal.kind !== "error") {
      throw new Error("expected an error close");
    }
    expect(terminal.cause).toBeInstanceOf(Error);
    expect(socket.state).toBe("error");
    expect(nativeSocket.close).toHaveBeenCalledTimes(closeCalls);
    expectOnlyErrorSink(nativeSocket);
  });
});
