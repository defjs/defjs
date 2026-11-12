import { describe, expect, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withWebSocketHandle,
  withRetry,
} from "../client";
import {
  createNetworkFault,
  createPreflightFault,
  createUndecodedHttpStatusFault,
  ERR_ABORTED,
} from "../error";
import { struct } from "../struct";
import { defineWebSocket, type SocketAwaitResult } from "./index";
import {
  type FakeWebSocket,
  closeEventOnly,
  expectOnlyErrorSink,
  openSession,
  stubFakeWebSocket,
} from "../../test/fake_web_socket";
import {
  useFakeClock,
  createDeferred,
  clientObservingAbortListeners,
  run,
} from "../../test/web_socket_support";

describe("web socket reconnect with a mock handle", () => {
  test("should emit runtime error when send throws during queued flush", async () => {
    const fake = stubFakeWebSocket(
      { handshake: "manual" },
      (Socket) =>
        class extends Socket {
          override send(): void {
            throw new Error("send failed");
          }
        },
    );

    const useSocket = defineWebSocket({
      maxOutgoingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("msg"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });

    const client = createClient(
      withEndpoint("http://localhost"),
      withWebSocketHandle(globalThis.WebSocket),
      withRetry({ maxRetries: 1, delayMs: 0 }),
    );
    const { session: socket, socket: firstSocket } = await openSession(
      run(client, useSocket),
      fake,
    );

    let runtimeError: unknown;
    socket.onRuntimeError((err: unknown) => {
      runtimeError = err;
    });
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);
    const reconnecting = createDeferred<void>();
    socket.onStateChange((state) => {
      if (state !== "reconnecting") {
        return;
      }
      socket.send({ type: "msg", text: "queued" });
      reconnecting.resolve(undefined);
    });

    firstSocket.peerClose(1000);
    await reconnecting.promise;
    await vi.waitFor(() => expect(fake.sockets).toHaveLength(2));
    const replacement = fake.sockets[1];
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }
    replacement.open();

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(runtimeError).toBeDefined();
    await expect(pendingReceive).resolves.toMatchObject({
      message: "send failed",
    });
    expect(socket.state).toBe("error");
  });

  test("reports a manual close, not the late error, when session.close() runs during a reconnect handshake", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket, socket: first } = await openSession(
      run(
        createClient(
          withEndpoint("http://localhost"),
          withRetry({ maxRetries: 1, delayMs: 0 }),
        ),
        endpoint,
      ),
      fake,
    );
    if (!socket || !first) throw new Error("Expected socket");
    let runtimeError: unknown;
    socket.onRuntimeError((error: unknown) => {
      runtimeError = error;
    });

    first.drop();
    await vi.waitFor(() => expect(fake.sockets).toHaveLength(2));
    const replacement = fake.sockets[1];
    if (!replacement) throw new Error("Expected replacement socket");
    expect(replacement.readyState).toBe(0);

    // `close()` on a CONNECTING socket fails the connection; `ws` then emits a late `error`.
    socket.close();
    expect(replacement.closeCalls).toHaveLength(1);
    expect(() => replacement.drop()).not.toThrow();
    await vi.runAllTimersAsync();

    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(socket.state).toBe("closed");
    expect(runtimeError).toBeUndefined();
    expect(fake.sockets).toHaveLength(2);
    expectOnlyErrorSink(replacement);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should wait for the errored physical socket close before constructing its replacement", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0 },
      }),
      fake,
    );
    const firstSocket = fake.last();

    // The standard fires `error` and `close` in one task. A handle that does not, such as `ws`, can fire `error` alone.
    firstSocket.dispatchEvent(new Event("error"));

    expect(fake.sockets).toHaveLength(1);
    expect(firstSocket.closeCalls).toHaveLength(1);
    // Close stays withheld. A premature replacement queued on a timer would appear on this turn,
    // which is still short of the close grace.
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.sockets).toHaveLength(1);

    closeEventOnly(firstSocket, {
      code: 1006,
      reason: "transport",
      wasClean: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.sockets).toHaveLength(2);
    // autoOpen is off, so the replacement stays connecting until this turn opens it.
    fake.sockets[1]?.open();
    expect(socket.connection.generation).toBe(2);

    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await socket.closed;
  });

  test("should keep the replacement open after the errored socket close grace elapses", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0 },
      }),
      fake,
    );
    const firstSocket = fake.last();

    firstSocket.drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.sockets).toHaveLength(2);
    fake.sockets[1]?.open();
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(2);

    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await socket.closed;
  });

  test("releases each reconnect generation's abort listeners before the next generation listens", async () => {
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const { client, observed } = clientObservingAbortListeners();
    const useSocket = defineWebSocket({
      incoming: struct.object({
        n: struct.number(),
        type: struct.literal("tick"),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(client, useSocket, {
        retry: { maxRetries: 3, delayMs: 0 },
      }),
      fake,
    );
    const abortListeners = observed.current;
    if (!abortListeners) {
      throw new Error("Expected the interceptor to observe the signal");
    }
    const iterator = socket.receive[Symbol.asyncIterator]();
    let generation = abortListeners.listeners();
    expect(generation.length).toBeGreaterThan(0);
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(1);

    for (let drop = 0; drop < 3; drop += 1) {
      const previous = generation;
      fake.sockets[drop]?.peerClose(1012, "drop");
      await vi.waitFor(() => expect(fake.sockets).toHaveLength(drop + 2));
      abortListeners.assertReleased(previous);
      const replacement = fake.sockets[drop + 1];
      if (!replacement) throw new Error("Expected replacement socket");
      replacement.open();
      await vi.waitFor(() =>
        expect(socket.connection.generation).toBe(drop + 2),
      );
      expect(socket.state).toBe("open");
      generation = abortListeners.listeners();
      expect(generation.length).toBeGreaterThan(0);
      abortListeners.assertReleased(previous);
      replacement.receive(JSON.stringify({ n: drop + 2, type: "tick" }));
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { n: drop + 2, type: "tick" },
      });
    }

    expect(fake.sockets).toHaveLength(4);
    expect(socket.connection.generation).toBe(4);
    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
    expect(socket.state).toBe("closed");
    expect(socket.connection.generation).toBe(4);
    abortListeners.assertReleased(generation);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  test("should reconnect after more recovered outages than the attempt budget", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const policyAttempts: number[] = [];
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: {
          maxRetries: 2,
          delayMs: 100,
          factor: 2,
          jitter: 0,
          shouldRetry(context: { attempt: number }) {
            policyAttempts.push(context.attempt);
            return true;
          },
        },
      }),
      fake,
    );

    for (let drop = 0; drop < 3; drop += 1) {
      fake.sockets[drop]?.peerClose(1012, "drop");
      // Longer than a compounded delay, so a lifetime budget fails by refusing the next socket.
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.sockets).toHaveLength(drop + 2);
      fake.sockets[drop + 1]?.open();
      expect(socket.state).toBe("open");
      expect(socket.connection.generation).toBe(drop + 2);
    }

    expect(policyAttempts).toEqual([1, 1, 1]);
    expect(socket.state).toBe("open");

    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await socket.closed;
  });

  test("should use the base reconnect delay after each recovered outage", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 2, delayMs: 100, factor: 2, jitter: 0 },
      }),
      fake,
    );

    for (let generation = 1; generation <= 2; generation += 1) {
      fake.sockets[generation - 1]?.peerClose(1012, "drop");
      await vi.advanceTimersByTimeAsync(99);
      expect(fake.sockets).toHaveLength(generation);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.sockets).toHaveLength(generation + 1);
      fake.sockets[generation]?.open();
      expect(socket.state).toBe("open");
      expect(socket.connection.generation).toBe(generation + 1);
    }

    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await socket.closed;
  });

  test("should fail after a bounded grace when an errored socket never emits close", async () => {
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
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    // An `error` that no `close` follows: see the reconnect that waits for the errored socket above.
    nativeSocket.dispatchEvent(new Event("error"));

    expect(nativeSocket.closeCalls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);

    const closed = await socket.closed;
    expect(closed.kind).toBe("error");
    if (closed.kind !== "error") {
      throw new Error("expected an error close");
    }
    expect(closed.cause).toBeInstanceOf(Error);
    await expect(pendingReceive).resolves.toMatchObject({
      message: "WebSocket connection error",
    });
    expect(socket.state).toBe("error");
    expect(fake.sockets).toHaveLength(1);
    expect(nativeSocket.closeCalls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should snapshot the reconnect predicate before beforeConnect can mutate it", async () => {
    const fake = stubFakeWebSocket();
    let predicate = () => false;
    let predicateReads = 0;
    const retry = {
      maxRetries: 1,
      delayMs: 0,
      get shouldRetry() {
        predicateReads += 1;
        return predicate;
      },
    };
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const client = createClient(withEndpoint("http://localhost"), (config) => {
      config.retry = retry;
    });
    expect(predicateReads).toBe(0);
    const { session: socket } = await openSession(
      run(client, useSocket, {
        beforeConnect() {
          predicate = () => true;
        },
      }),
      fake,
    );
    expect(predicateReads).toBe(1);
    if (!socket || !fake.last()) {
      throw new Error("Expected socket");
    }
    const firstSocket = fake.last();

    firstSocket.peerClose(1012, "restart");
    await expect(socket.closed).resolves.toMatchObject({
      code: 1012,
      kind: "closed",
      reason: "restart",
    });
    expect(fake.sockets).toHaveLength(1);
  });

  test.each(["error", "close"] as const)(
    "should end a native %s as the failure it is when the retry policy declines",
    async (eventKind) => {
      const fake = stubFakeWebSocket();
      const predicate = vi.fn(() => false);
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const { session: socket } = await openSession(
        run(createClient(withEndpoint("http://localhost")), useSocket, {
          retry: { maxRetries: 1, delayMs: 0, shouldRetry: predicate },
        }),
        fake,
      );
      const pendingReceive = socket.receive[Symbol.asyncIterator]()
        .next()
        .catch((error: unknown) => error);

      if (eventKind === "error") {
        fake.last().drop();
      } else {
        fake.last().peerClose(1012, "restart");
      }

      // A declined retry ends the session as it would end without a policy: a connection error is an
      // error, a close frame is a normal end.
      if (eventKind === "error") {
        await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
        await expect(pendingReceive).resolves.toEqual(
          new Error("WebSocket connection error"),
        );
        expect(socket.state).toBe("error");
      } else {
        await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
        await expect(pendingReceive).resolves.toEqual({
          done: true,
          value: undefined,
        });
        expect(socket.state).toBe("closed");
      }
      expect(predicate).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["return false", "throw"] as const)(
    "should prefer an abort when reconnect policy callbacks %s after aborting",
    async (policyOutcome) => {
      const fake = stubFakeWebSocket();
      const controller = new AbortController();
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const predicate = vi.fn(() => {
        controller.abort(ERR_ABORTED);
        if (policyOutcome === "throw") {
          throw new Error("policy failed after abort");
        }
        return false;
      });
      const { session: socket } = await openSession(
        run(createClient(withEndpoint("http://localhost")), useSocket, {
          retry: { maxRetries: 1, delayMs: 0, shouldRetry: predicate },
          signal: controller.signal,
        }),
        fake,
      );
      const pendingReceive = socket.receive[Symbol.asyncIterator]()
        .next()
        .catch((error: unknown) => error);

      fake.last().peerClose(1012, "restart");

      await expect(socket.closed).resolves.toMatchObject({
        cause: ERR_ABORTED,
        kind: "aborted",
      });
      await expect(pendingReceive).resolves.toBe(ERR_ABORTED);
      expect(socket.state).toBe("aborted");
      expect(predicate).toHaveBeenCalledTimes(1);
      expect(fake.sockets).toHaveLength(1);
    },
  );

  test("should preserve terminal state when reconnect predicate closes the session and returns true", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    let exposedSocket: SocketAwaitResult<unknown, unknown>[1];
    const predicate = vi.fn(() => {
      exposedSocket?.close(1000, "owner declined");
      return true;
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0, shouldRetry: predicate },
      }),
      fake,
    );
    exposedSocket = socket;

    fake.last().peerClose(1012, "restart");

    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.state).toBe("closed");
    expect(fake.sockets).toHaveLength(1);
    expect(predicate).toHaveBeenCalledTimes(1);
  });

  test("should preserve owner close when reconnect predicate throws after closing the session", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    let exposedSocket: SocketAwaitResult<unknown, unknown>[1];
    const predicate = vi.fn(() => {
      exposedSocket?.close(1000, "owner declined");
      throw new Error("ignored after owner close");
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0, shouldRetry: predicate },
      }),
      fake,
    );
    exposedSocket = socket;

    fake.last().peerClose(1012, "restart");

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner declined",
    });
    expect(socket.state).toBe("closed");
    expect(fake.sockets).toHaveLength(1);
    expect(predicate).toHaveBeenCalledTimes(1);
  });

  test("should preserve an abort triggered by an observer during replacement open", async () => {
    const fake = stubFakeWebSocket();
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0 },
        signal: controller.signal,
      }),
      fake,
    );
    socket.onStateChange((state) => {
      if (state === "open" && socket.connection.generation === 2) {
        controller.abort(ERR_ABORTED);
      }
    });

    fake.last().peerClose(1012, "restart");

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(fake.sockets).toHaveLength(2);
  });

  test("should stop reconnect work when a reconnecting observer closes the logical session", async () => {
    const fake = stubFakeWebSocket();
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: {
          maxRetries: 1,
          delayMs: Number.MAX_VALUE,
          jitter: 1,
          maxDelayMs: Number.MAX_VALUE,
        },
      }),
      fake,
    );
    socket.onStateChange((state) => {
      if (state === "reconnecting") {
        socket.close(1000, "observer stopped reconnect");
      }
    });

    fake.last().peerClose(1012, "restart");
    const closeInfo = await socket.closed;

    expect(closeInfo).toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "observer stopped reconnect",
    });
    expect(socket.state).toBe("closed");
    expect(random).not.toHaveBeenCalled();
    expect(fake.sockets).toHaveLength(1);
    random.mockRestore();
  });

  test("should prefer observer abort over reconnect jitter overflow", async () => {
    const fake = stubFakeWebSocket();
    const controller = new AbortController();
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: {
          maxRetries: 1,
          delayMs: Number.MAX_VALUE,
          jitter: 1,
          maxDelayMs: Number.MAX_VALUE,
        },
        signal: controller.signal,
      }),
      fake,
    );
    socket.onStateChange((state) => {
      if (state === "reconnecting") {
        controller.abort(ERR_ABORTED);
      }
    });

    fake.last().peerClose(1012, "restart");
    const closeInfo = await socket.closed;

    expect(closeInfo).toMatchObject({ cause: ERR_ABORTED, kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(random).not.toHaveBeenCalled();
    expect(fake.sockets).toHaveLength(1);
    random.mockRestore();
  });

  test("should not settle twice when owner close interrupts an active reconnect delay", async () => {
    const fake = stubFakeWebSocket();
    const reconnecting = createDeferred<void>();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 1_000 },
      }),
      fake,
    );
    socket.onStateChange((state) => {
      if (state === "reconnecting") {
        reconnecting.resolve(undefined);
      }
    });

    fake.last().peerClose(1012, "restart");
    await reconnecting.promise;
    socket.close(1000, "owner stopped delay");

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner stopped delay",
    });
    expect(socket.state).toBe("closed");
    expect(fake.sockets).toHaveLength(1);
  });

  test("should saturate finite reconnect jitter overflow at the timer limit and finish after reconnecting", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: {
          maxRetries: 1,
          delayMs: Number.MAX_VALUE,
          jitter: 1,
          maxDelayMs: Number.MAX_VALUE,
        },
      }),
      fake,
    );
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    fake.last().peerClose(1012, "restart");
    await vi.advanceTimersByTimeAsync(2_147_483_646);
    expect(socket.state).toBe("reconnecting");
    expect(fake.sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fake.sockets).toHaveLength(2);
    fake.last().open();
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(2);

    // The open above restored the per-outage budget, so this close has to be the session's own.
    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
    await expect(pendingReceive).resolves.toMatchObject({ done: true });
    expect(socket.state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
    random.mockRestore();
  });

  test("should skip post-open setup when an observer closes the replacement", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0 },
      }),
      fake,
    );
    socket.onStateChange((state) => {
      if (state === "open" && socket.connection.generation === 2) {
        socket.close(1000, "observer stopped replacement");
      }
    });

    fake.last().peerClose(1012, "restart");

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "observer stopped replacement",
    });
    expect(socket.state).toBe("closed");
    expect(fake.sockets).toHaveLength(2);
  });

  test("should preserve the last opened connection snapshot when aborting a connecting replacement", async () => {
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        retry: { maxRetries: 1, delayMs: 0 },
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(fake.sockets).toHaveLength(1));
    const firstSocket = fake.sockets[0];
    if (!firstSocket) {
      throw new Error("Expected first socket");
    }
    firstSocket.open({ protocol: "first" });
    const [, socket] = await executePromise;
    if (!socket) {
      throw new Error("Expected logical session");
    }
    const openedConnection = socket.connection;

    firstSocket.peerClose(1012, "restart");
    await vi.waitFor(() => expect(fake.sockets).toHaveLength(2));
    const replacement = fake.sockets[1];
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }
    controller.abort(ERR_ABORTED);

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.connection).toEqual(openedConnection);
    expect(socket.connection).toMatchObject({
      generation: 1,
      protocol: "first",
    });
  });

  test.each(["abort", "close"] as const)(
    "should not publish replacement open after native flush synchronously triggers %s",
    async (action) => {
      const controller = new AbortController();
      let exposedSocket: SocketAwaitResult<unknown, unknown>[1];
      const fake = stubFakeWebSocket(
        {},
        (Socket) =>
          class extends Socket {
            override send(data: Parameters<FakeWebSocket["send"]>[0]): void {
              super.send(data);
              if (fake.sockets.length !== 2) {
                return;
              }
              if (action === "abort") {
                controller.abort(ERR_ABORTED);
              } else {
                exposedSocket?.close(1000, "flush owner close");
              }
            }
          },
      );
      const useSocket = defineWebSocket({
        maxOutgoingQueueSize: 1,
        incoming: struct.unknown(),
        outgoing: struct.object({
          type: struct.literal("message"),
          text: struct.string(),
        }),
        path: "/ws/test",
      });
      const { session: socket } = await openSession(
        run(createClient(withEndpoint("http://localhost")), useSocket, {
          retry: { maxRetries: 1, delayMs: 0 },
          signal: controller.signal,
        }),
        fake,
      );
      exposedSocket = socket;
      const replacementStates: string[] = [];
      socket.onStateChange((state) => {
        if (socket.connection.generation === 2) {
          replacementStates.push(state);
        }
        if (state === "reconnecting") {
          socket.send({ text: "queued", type: "message" });
        }
      });

      fake.last().peerClose(1012, "restart");

      await expect(socket.closed).resolves.toMatchObject(
        action === "abort"
          ? { cause: ERR_ABORTED, kind: "aborted" }
          : { code: 1000, kind: "closed", reason: "flush owner close" },
      );
      expect(replacementStates).not.toContain("open");
      expect(socket.state).toBe(action === "abort" ? "aborted" : "closed");
      expect(fake.sockets).toHaveLength(2);
      expect(fake.sockets[1]?.sent).toHaveLength(1);
    },
  );

  test("should not deliver a stale reconnecting state after a listener closes reentrantly", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 30 },
      }),
      fake,
    );
    const laterListenerStates: string[] = [];
    socket.onStateChange((state) => {
      if (state === "reconnecting") socket.close(1000, "owner stopped");
    });
    socket.onStateChange((state) => laterListenerStates.push(state));

    fake.last().peerClose(1012, "restart");

    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(laterListenerStates).toEqual(["closing", "closed"]);
    expect(socket.state).toBe("closed");
    expect(fake.sockets).toHaveLength(1);
  });

  test("should terminate after a reconnect beforeConnect failure and reject pending receive", async () => {
    const fake = stubFakeWebSocket();
    const attempts: number[] = [];
    const hookFailure = new Error("refresh failed");
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        beforeConnect({ attempt }: { attempt: number }) {
          attempts.push(attempt);
          if (attempt === 1) {
            throw hookFailure;
          }
        },
        retry: { maxRetries: 1, delayMs: 0 },
      }),
      fake,
    );
    const pending = socket.receive[Symbol.asyncIterator]().next();

    fake.last().peerClose(1012, "restart");

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    await expect(pending).rejects.toMatchObject({ code: "EXT_HOOK_FAILED" });
    expect(socket.state).toBe("error");
    expect(attempts).toEqual([0, 1]);
    expect(fake.sockets).toHaveLength(1);
  });

  test("should terminate when reconnect policy throws and reject pending receive", async () => {
    const fake = stubFakeWebSocket();
    const policyFailure = new Error("policy failed");
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: {
          maxRetries: 1,
          delayMs: 0,
          shouldRetry() {
            throw policyFailure;
          },
        },
      }),
      fake,
    );
    const pending = socket.receive[Symbol.asyncIterator]().next();

    fake.last().peerClose(1012, "restart");

    await expect(socket.closed).resolves.toMatchObject({
      cause: policyFailure,
      kind: "error",
    });
    await expect(pending).rejects.toBe(policyFailure);
    expect(socket.state).toBe("error");
  });

  test("should reject startup when reconnect policy throws after a pre-open close", async () => {
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const policyFailure = new Error("pre-open policy failed");
    const predicate = vi.fn(() => {
      throw policyFailure;
    });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        retry: { maxRetries: 1, delayMs: 0, shouldRetry: predicate },
      },
    );

    await vi.waitFor(() => expect(fake.last()).toBeDefined());
    fake.last().drop();

    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({
      cause: policyFailure,
      code: "EXT_HOOK_FAILED",
    });
    expect(socket).toBeUndefined();
    expect(connection).toMatchObject({ generation: 0 });
    expect(predicate).toHaveBeenCalledTimes(1);
    expect(fake.sockets).toHaveLength(1);
  });

  test("should fail receive with AbortError when a post-open reconnect policy throws undefined", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: {
          maxRetries: 1,
          delayMs: 0,
          shouldRetry() {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- shouldRetry under test throws undefined to exercise handling of a non-Error throw
            throw undefined;
          },
        },
      }),
      fake,
    );
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    fake.last().peerClose(1012, "restart");

    await expect(socket.closed).resolves.toEqual({
      cause: undefined,
      code: 1012,
      kind: "error",
      reason: "restart",
      wasClean: true,
    });
    await expect(pendingReceive).resolves.toMatchObject({ name: "AbortError" });
    expect(socket.state).toBe("error");
  });

  test.each([
    createPreflightFault("EXT_HOOK_FAILED", new Error("reconnect policy")),
    createUndecodedHttpStatusFault({
      headers: new Headers(),
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      url: "http://localhost/ws/test",
    }),
    createNetworkFault(new Error("reconnect policy offline")),
  ])(
    "should preserve a $code fault thrown by the reconnect policy",
    async (policyFailure) => {
      const fake = stubFakeWebSocket();
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const { session: socket } = await openSession(
        run(createClient(withEndpoint("http://localhost")), useSocket, {
          retry: {
            maxRetries: 1,
            delayMs: 0,
            shouldRetry() {
              throw policyFailure;
            },
          },
        }),
        fake,
      );
      const pending = socket.receive[Symbol.asyncIterator]().next();

      fake.last().peerClose(1012, "restart");

      await expect(socket.closed).resolves.toMatchObject({
        cause: policyFailure,
        kind: "error",
      });
      await expect(pending).rejects.toBe(policyFailure);
      expect(socket.state).toBe("error");
    },
  );

  test("should not replay a frame after a physical reconnect", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("mutation"),
        id: struct.number(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0 },
      }),
      fake,
    );
    const firstSocket = fake.last();

    socket.send({ id: 1, type: "mutation" });
    firstSocket.peerClose(1012, "restart");
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    const secondSocket = fake.last();
    if (!secondSocket || secondSocket === firstSocket) {
      throw new Error("Expected a replacement socket");
    }

    expect(firstSocket.sent).toHaveLength(1);
    expect(secondSocket.sent).toHaveLength(0);
    socket.send({ id: 2, type: "mutation" });
    expect(secondSocket.sent).toHaveLength(1);
    socket.close(1000, "done");
    await socket.closed;
  });
});
