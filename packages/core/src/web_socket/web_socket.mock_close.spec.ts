import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint } from "../client";
import { ERR_ABORTED } from "../error";
import { struct } from "../struct";
import { defineWebSocket } from "./index";
import {
  type FakeWebSocket,
  expectInertErrorListener,
  expectOnlyErrorSink,
  openSession,
  stubFakeWebSocket,
} from "../../test/fake_web_socket";
import {
  useFakeClock,
  clientObservingAbortListeners,
  run,
} from "../../test/web_socket_support";

/** `Socket`, except that its n-th `close()` call throws `failures[n]`. A call past the list closes normally. */
function closeThrows(
  Socket: typeof FakeWebSocket,
  failures: readonly unknown[],
): typeof FakeWebSocket {
  let calls = 0;
  return class extends Socket {
    override close(code?: number, reason?: string): void {
      const call = calls;
      calls += 1;
      if (call in failures) {
        this.closeCalls.push({ code, reason });
        throw failures[call];
      }
      super.close(code, reason);
    }
  };
}

describe("web socket close and disposal with a mock handle", () => {
  test("should classify a TimeoutError abort after open as a timeout close", async () => {
    const fake = stubFakeWebSocket();
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
    expect(fake.sockets[0]?.closeCalls).toHaveLength(1);
  });

  test("should preserve an external abort triggered by a closing observer", async () => {
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        signal: controller.signal,
      }),
      fake,
    );
    const nativeSocket = fake.last();
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
    expect(nativeSocket.closeCalls).toHaveLength(1);
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
          const fake = stubFakeWebSocket(
            { handshake: "manual" },
            (Socket) =>
              class extends Socket {
                override addEventListener(
                  type: string,
                  callback: EventListenerOrEventListenerObject | null,
                  options?: AddEventListenerOptions | boolean,
                ): void {
                  super.addEventListener(type, callback, options);
                  if (
                    type === registrationPoint &&
                    !abortedDuringRegistration
                  ) {
                    abortedDuringRegistration = true;
                    if (closeMode === "synchronous") {
                      // A handle that closes inside `close()`: its `close` event arrives before `close()` returns.
                      this.close = (code?: number, reason?: string) => {
                        super.close(code, reason);
                        this.peerClose(1000);
                      };
                    }
                    controller.abort(ERR_ABORTED);
                  }
                }
              },
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
          const nativeSocket = fake.last();
          expect(nativeSocket.closeCalls).toHaveLength(1);
          expectOnlyErrorSink(nativeSocket);

          // A connecting socket that was closed can only fail, and only afterwards. Late events of every kind must
          // find no listener, whatever order they arrive in.
          if (closeMode === "asynchronous") {
            nativeSocket.drop();
          }
          nativeSocket.dispatchEvent(new Event("open"));
          nativeSocket.dispatchEvent(
            new MessageEvent("message", { data: "null" }),
          );
          nativeSocket.dispatchEvent(
            new CloseEvent("close", { code: 1000, reason: "late" }),
          );
          await vi.runAllTimersAsync();

          expectOnlyErrorSink(nativeSocket);
          expect(nativeSocket.closeCalls).toHaveLength(1);
          expect(fake.sockets).toHaveLength(1);
          expect(vi.getTimerCount()).toBe(0);
        },
      );
    },
  );

  test("should surface runtime cause on error event before close", async () => {
    const fake = stubFakeWebSocket({ handshake: "manual" });

    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const { session: socket, socket: nativeSocket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    nativeSocket.drop();
    // `handleError` detaches itself before the close event arrives and leaves the no-op sink.
    expect(nativeSocket.closeCalls).toHaveLength(1);
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
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.object({
        n: struct.number(),
        type: struct.literal("tick"),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 2, delayMs: 0 },
      }),
      fake,
    );
    const iterator = socket.receive[Symbol.asyncIterator]();
    const opened = [fake.last()];
    expect(fake.last().listenerCount("message")).toBe(1);
    fake.last().receive(JSON.stringify({ n: 1, type: "tick" }));
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
      if (!nativeSocket) {
        throw new Error("Expected the generation being retired");
      }
      if (how === "failure") {
        // The `error` event does not release the listener; the `close` event that follows does.
        let attachedAtError = -1;
        nativeSocket.addEventListener("error", () => {
          attachedAtError = nativeSocket.listenerCount("message");
        });
        nativeSocket.drop();
        expect(attachedAtError).toBe(1);
      } else {
        nativeSocket.peerClose(1012, how);
      }
      expect(nativeSocket.listenerCount("message")).toBe(0);
      nativeSocket.receive(JSON.stringify({ n: 99, type: "tick" }));
      await vi.waitFor(() => expect(fake.sockets).toHaveLength(index + 2));
      const replacement = fake.sockets[index + 1];
      if (!replacement) throw new Error("Expected replacement socket");
      replacement.open();
      await vi.waitFor(() =>
        expect(socket.connection.generation).toBe(index + 2),
      );
      expect(replacement.listenerCount("message")).toBe(1);
      opened.push(replacement);
      replacement.receive(JSON.stringify({ n: index + 2, type: "tick" }));
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { n: index + 2, type: "tick" },
      });
    };

    await retire(0, "reconnect");
    await retire(1, "failure");

    const current = opened[2];
    if (!current) {
      throw new Error("Expected the open generation");
    }
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(3);
    socket.close(1000, "done");
    current.peerClose(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
    expect(socket.state).toBe("closed");
    expect(socket.connection.generation).toBe(3);
    expect(current.listenerCount("message")).toBe(0);
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
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const controller = new AbortController();
    const { client, observed } = clientObservingAbortListeners();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(client, useSocket, {
        retry: { maxRetries: 1, delayMs: 0 },
        signal: controller.signal,
      }),
      fake,
    );
    const abortListeners = observed.current;
    if (!abortListeners) {
      throw new Error("Expected the interceptor to observe the signal");
    }
    fake.last().peerClose(1012, "drop");
    await vi.waitFor(() => expect(fake.sockets).toHaveLength(2));
    fake.sockets[1]?.open();
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
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const { client, observed } = clientObservingAbortListeners();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(client, useSocket, {
        retry: { maxRetries: 1, delayMs: 0 },
      }),
      fake,
    );
    const abortListeners = observed.current;
    if (!abortListeners) {
      throw new Error("Expected the interceptor to observe the signal");
    }
    fake.last().peerClose(1012, "drop");
    await vi.waitFor(() => expect(fake.sockets).toHaveLength(2));
    fake.sockets[1]?.open();
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    const generation = abortListeners.listeners();
    expect(socket.state).toBe("open");
    expect(generation.length).toBeGreaterThan(0);

    const disposal = Promise.resolve(socket[Symbol.asyncDispose]());
    fake.last().peerClose(1000);
    await expect(disposal).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(socket.state).toBe("closed");
    expect(socket.connection.generation).toBe(2);
    abortListeners.assertReleased(generation);
    for (const nativeSocket of fake.sockets) {
      expectOnlyErrorSink(nativeSocket);
    }
  });

  test("should settle an error attempt when native close throws synchronously", async () => {
    const fake = stubFakeWebSocket({}, (Socket) =>
      closeThrows(Socket, [new Error("close failed")]),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    fake.last().drop();

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(socket.state).toBe("error");
    expect(fake.last().closeCalls).toHaveLength(1);
  });

  test("should expose generation and native bufferedAmount", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    if (!socket || !fake.last()) {
      throw new Error("Expected socket");
    }

    fake.last().bufferedAmount = 23;
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
      const fake = stubFakeWebSocket();
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const { session: socket } = await openSession(
        run(createClient(withEndpoint("http://localhost")), useSocket),
        fake,
      );

      expect(() => socket.close(code)).toThrow(
        expect.objectContaining({ name: "InvalidAccessError" }),
      );
      expect(socket.state).toBe("open");
      expect(fake.last().closeCalls).toHaveLength(0);

      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should reject a close reason over 123 UTF-8 bytes without changing session state", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    expect(() => socket.close(1000, `${"a".repeat(121)}猫`)).toThrow(
      expect.objectContaining({ name: "SyntaxError" }),
    );
    expect(socket.state).toBe("open");
    expect(fake.last().closeCalls).toHaveLength(0);

    socket.close(1000, "done");
    await socket.closed;
  });

  test("should isolate state and runtime observer failures", async () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

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
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

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
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

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
    const fake = stubFakeWebSocket({}, (Socket) =>
      closeThrows(Socket, [closeFailure]),
    );
    const controller = new AbortController();
    const shouldRetry = vi.fn(() => true);
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0, shouldRetry },
        signal: controller.signal,
      }),
      fake,
    );

    controller.abort(ERR_ABORTED);

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    await Promise.resolve();
    expect(fake.last().closeCalls).toHaveLength(1);
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  test("should end the session with an error and rethrow when the native close throws", async () => {
    const firstFailure = new Error("first close failed");
    const fake = stubFakeWebSocket({}, (Socket) =>
      closeThrows(Socket, [firstFailure]),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    expect(() => socket.close(3000, "owner close")).toThrow(firstFailure);
    expect(socket.state).toBe("error");
    expect(fake.last().closeCalls).toHaveLength(2);
    expect(() => socket.close(200, "invalid after terminal")).toThrow(
      expect.objectContaining({ name: "InvalidAccessError" }),
    );
    expect(fake.last().closeCalls).toHaveLength(2);
    await expect(socket.closed).resolves.toMatchObject({
      cause: firstFailure,
      kind: "error",
    });
    expect(fake.last().closeCalls).toHaveLength(2);
  });

  test("should settle error after both native close calls throw without a third attempt", async () => {
    const firstFailure = new Error("first close failed");
    const fallbackFailure = new Error("fallback close failed");
    const fake = stubFakeWebSocket({}, (Socket) =>
      closeThrows(Socket, [firstFailure, fallbackFailure]),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );
    const nativeSocket = fake.last();

    expect(() => socket.close(3000, "owner close")).toThrow(firstFailure);
    const closed = await socket.closed;
    expect(closed).toMatchObject({ cause: firstFailure, kind: "error" });
    expect(socket.state).toBe("error");
    expect(nativeSocket.closeCalls).toHaveLength(2);
    expect(() => socket.close(3001, "again")).not.toThrow();
    expect(nativeSocket.closeCalls).toHaveLength(2);
    expect(() => socket.close(200, "invalid after terminal")).toThrow(
      expect.objectContaining({ name: "InvalidAccessError" }),
    );
    expect(nativeSocket.closeCalls).toHaveLength(2);

    const removeEventListener = vi.spyOn(nativeSocket, "removeEventListener");
    nativeSocket.peerClose(1000, "late physical close");
    const removeEventListenerCallsAfterClose =
      removeEventListener.mock.calls.length;
    expect(socket.bufferedAmount).toBe(0);
    expect(nativeSocket.closeCalls).toHaveLength(2);
    expectOnlyErrorSink(nativeSocket);

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toBe(closed);
    expect(nativeSocket.closeCalls).toHaveLength(2);
    expect(removeEventListener).toHaveBeenCalledTimes(
      removeEventListenerCallsAfterClose,
    );
    expectOnlyErrorSink(nativeSocket);
  });

  test.each([1000, 3000, 4999])("should accept close code %s", async (code) => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    expect(() => socket.close(code, "accepted")).not.toThrow();
    await expect(socket.closed).resolves.toMatchObject({
      code,
      kind: "closed",
      reason: "accepted",
    });
  });

  test("should accept a 123-byte UTF-8 close reason", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );
    const reason = `${"a".repeat(120)}猫`;

    expect(() => socket.close(1000, reason)).not.toThrow();
    await expect(socket.closed).resolves.toMatchObject({
      kind: "closed",
      reason,
    });
  });

  test("should cache one disposal promise and wait for native close plus lifecycle teardown", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );
    const nativeSocket = fake.last();
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    let firstDispose: PromiseLike<void> | undefined;

    expect(() => {
      firstDispose = socket[Symbol.asyncDispose]();
    }).not.toThrow();
    const secondDispose = socket[Symbol.asyncDispose]();

    expect(firstDispose).toBe(secondDispose);
    expect(nativeSocket.closeCalls).toHaveLength(0);
    let settled = false;
    const disposal = Promise.resolve(firstDispose).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(nativeSocket.closeCalls).toHaveLength(1);
    expect(nativeSocket.listenerCount()).toBeGreaterThan(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(24);
    expect(settled).toBe(false);
    nativeSocket.peerClose(1000);
    await expect(disposal).resolves.toBeUndefined();

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
    });
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(nativeSocket.closeCalls).toHaveLength(1);
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
      const fake = stubFakeWebSocket({ handshake: "manual" }, (Socket) =>
        closeThrows(Socket, [closeFailure]),
      );
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const { session: socket } = await openSession(
        run(createClient(withEndpoint("http://localhost")), useSocket),
        fake,
      );
      const nativeSocket = fake.last();
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

      expect(nativeSocket.closeCalls).toHaveLength(2);
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
    const fake = stubFakeWebSocket({ handshake: "manual" }, (Socket) =>
      closeThrows(Socket, [firstFailure, fallbackFailure]),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );
    const nativeSocket = fake.last();
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
    expect(nativeSocket.closeCalls).toHaveLength(2);
    expectOnlyErrorSink(nativeSocket);
    expect(socket.bufferedAmount).toBe(0);
  });

  test("should only await teardown when disposing an already aborted session", async () => {
    const fake = stubFakeWebSocket();
    const controller = new AbortController();
    const abortCause = new Error("owner aborted");
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        signal: controller.signal,
      }),
      fake,
    );
    const nativeSocket = fake.last();
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    controller.abort(abortCause);
    const terminal = await socket.closed;
    await expect(pendingReceive).resolves.toBe(abortCause);
    const closeCalls = nativeSocket.closeCalls.length;

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toBe(terminal);
    expect(terminal).toMatchObject({ cause: abortCause, kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.closeCalls).toHaveLength(closeCalls);
    expectOnlyErrorSink(nativeSocket);
  });

  test("should only await teardown when disposing an already errored session", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );
    const nativeSocket = fake.last();
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    nativeSocket.drop();
    const terminal = await socket.closed;
    await expect(pendingReceive).resolves.toMatchObject({
      message: "WebSocket connection error",
    });
    const closeCalls = nativeSocket.closeCalls.length;

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
    expect(nativeSocket.closeCalls).toHaveLength(closeCalls);
    expectOnlyErrorSink(nativeSocket);
  });
});
