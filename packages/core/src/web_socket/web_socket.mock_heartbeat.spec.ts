import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint, withWebSocketHandle } from "../client";
import { ERR_ABORTED } from "../error";
import { struct } from "../struct";
import { defineWebSocket } from "./index";
import {
  useFakeClock,
  lastMockInstance,
  mockInstances,
  createMockWebSocketClass,
  createDeferred,
  expectOnlyErrorSink,
  encodeMessage,
  run,
} from "../../test/mock_web_socket";

describe("web socket heartbeat with a mock handle", () => {
  test("should run heartbeat through an injected handle without global WebSocket", async () => {
    useFakeClock();
    const InjectedWebSocket = createMockWebSocketClass({
      autoOpen: false,
      emitCloseEvent: false,
    });
    vi.stubGlobal("WebSocket", undefined);
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const client = createClient(
      withEndpoint("http://localhost"),
      withWebSocketHandle(InjectedWebSocket),
    );
    const executePromise = run(client, useSocket, {
      heartbeat: { intervalMs: 5, message: () => ({ type: "ping" }) },
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;

    await vi.advanceTimersByTimeAsync(5);
    expect(nativeSocket.send).toHaveBeenCalled();
    socket.close(1000, "done");
    nativeSocket.triggerClose({ code: 1000, reason: "done", wasClean: true });
    await socket.closed;
  });

  test("F062 should keep an injected socket open when send synchronously delivers every heartbeat pong", async () => {
    useFakeClock();
    const isAck = vi.fn((message: { type: string }) => message.type === "pong");
    const InjectedWebSocket = createMockWebSocketClass({
      autoOpen: false,
      emitCloseEvent: false,
      onSend() {
        lastMockInstance?.triggerMessage('{"type":"pong"}');
      },
    });
    vi.stubGlobal("WebSocket", undefined);
    const useSocket = defineWebSocket({
      incoming: struct.object({ type: struct.literal("pong") }),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const client = createClient(
      withEndpoint("http://localhost"),
      withWebSocketHandle(InjectedWebSocket),
    );
    const executePromise = run(client, useSocket, {
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
        isAck,
        message: () => ({ type: "ping" }),
      },
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [error, socket] = await executePromise;
    if (!socket || !lastMockInstance) throw new Error("Expected open socket");
    const nativeSocket = lastMockInstance;
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => runtimeErrors.push(runtimeError));

    try {
      expect(error).toBeNull();
      await vi.advanceTimersByTimeAsync(450);

      expect(runtimeErrors).toEqual([]);
      expect(socket.state).toBe("open");
      expect(nativeSocket.readyState).toBe(InjectedWebSocket.OPEN);
      expect(nativeSocket.send).toHaveBeenCalledTimes(4);
      expect(nativeSocket.send).toHaveBeenLastCalledWith('{"type":"ping"}');
      expect(isAck).toHaveBeenCalledTimes(4);
      expect(isAck).toHaveBeenLastCalledWith({ type: "pong" });
      expect(nativeSocket.close).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      socket.close(1000, "test complete");
      nativeSocket.triggerClose({
        code: 1000,
        reason: "test complete",
        wasClean: true,
      });
      await socket.closed;
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  test("should send the next heartbeat after a decoded pong acknowledges the open cycle", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    let ackChecks = 0;
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: {
          intervalMs: 20,
          isAck(message: { type: string }) {
            ackChecks += 1;
            return message.type === "pong";
          },
          message: () => ({ type: "ping" }),
          timeoutMs: 200,
        },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError);
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(nativeSocket.send).toHaveBeenCalledTimes(1);
    nativeSocket.triggerMessage(JSON.stringify({ ok: true, type: "pong" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(ackChecks).toBe(1);
    await vi.advanceTimersByTimeAsync(20);

    expect(nativeSocket.send).toHaveBeenCalledTimes(2);
    expect(runtimeErrors).toEqual([]);
    expect(socket.state).toBe("open");
    socket.close(1000, "done");
    nativeSocket.triggerClose({ code: 1000, reason: "done", wasClean: true });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
  });

  test("should stop a heartbeat callback that aborts the logical session before send or timeout", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: {
          intervalMs: 10,
          message() {
            controller.abort(ERR_ABORTED);
            return { type: "ping" };
          },
          timeoutMs: 1_000,
        },
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;

    await vi.advanceTimersByTimeAsync(10);

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should stop heartbeat timers only after accepting a valid manual close request", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: { intervalMs: 100 },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;

    expect(vi.getTimerCount()).toBe(1);
    expect(() => socket.close(200, "invalid")).toThrow(
      expect.objectContaining({ name: "InvalidAccessError" }),
    );
    expect(vi.getTimerCount()).toBe(1);

    socket.close(1000, "owner closed");
    expect(socket.state).toBe("closing");
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    nativeSocket.triggerClose({
      code: 1000,
      reason: "owner closed",
      wasClean: true,
    });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner closed",
    });
  });

  test("should not acknowledge through a heartbeat runtime removed by its isAck callback", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck() {
            controller.abort(ERR_ABORTED);
            return true;
          },
        },
        signal: controller.signal,
      },
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

    nativeSocket.triggerMessage(JSON.stringify({ ok: true, type: "pong" }));
    await vi.advanceTimersByTimeAsync(0);

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    await expect(pendingReceive).resolves.toBe(ERR_ABORTED);
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should ignore an isAck rejection after the callback aborts its heartbeat session", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck() {
            controller.abort(ERR_ABORTED);
            throw new Error("late classifier failure");
          },
        },
        signal: controller.signal,
      },
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

    nativeSocket.triggerMessage(JSON.stringify({ ok: true, type: "pong" }));
    await vi.advanceTimersByTimeAsync(0);

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    await expect(pendingReceive).resolves.toBe(ERR_ABORTED);
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should fail the session with the cause when an isAck classifier throws", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const failure = new Error("classifier failure");
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck() {
            throw failure;
          },
        },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    lastMockInstance.triggerMessage(JSON.stringify({ ok: true, type: "pong" }));
    await vi.advanceTimersByTimeAsync(0);

    await expect(socket.closed).resolves.toMatchObject({
      cause: failure,
      kind: "error",
    });
    await expect(pendingReceive).resolves.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should snapshot heartbeat config before beforeConnect can mutate it", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    let configuredInterval = 20;
    let intervalReads = 0;
    const heartbeat = {
      get intervalMs() {
        intervalReads += 1;
        return intervalReads === 1
          ? configuredInterval
          : Number.POSITIVE_INFINITY;
      },
      message: () => ({ type: "ping" as const }),
    };
    let socketExistedDuringHook = false;
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"), (config) => {
      // Keep the getter live to exercise the operation's own snapshot.
      config.webSocket.heartbeat = heartbeat;
    });
    expect(intervalReads).toBe(0);
    const executePromise = run(client, useSocket, {
      beforeConnect() {
        socketExistedDuringHook = typeof lastMockInstance !== "undefined";
        configuredInterval = Number.POSITIVE_INFINITY;
      },
    });

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    expect(socketExistedDuringHook).toBe(false);
    expect(intervalReads).toBe(1);
    expect(() => lastMockInstance?.triggerOpen()).not.toThrow();
    const [error, socket] = await executePromise;
    expect(error).toBeNull();
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    // The snapshotted 20ms interval must fire even though the live config is now infinite.
    await vi.advanceTimersByTimeAsync(20);
    expect(lastMockInstance.send).toHaveBeenCalled();
    socket.close(1000, "done");
    lastMockInstance.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await socket.closed;
  });

  test("should classify an arrived heartbeat ack while draining after native close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck: (message: { type: string }) => message.type === "pong",
        },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const data = createDeferred<ArrayBuffer>();
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(data.promise);
    const iterator = socket.receive[Symbol.asyncIterator]();

    lastMockInstance.triggerMessage(blob);
    lastMockInstance.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    data.resolve(encodeMessage({ ok: true, type: "pong" }));

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
  });

  test("should retain the heartbeat classifier while draining an arrived ack after manual close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck: (message: { type: string }) => message.type === "pong",
        },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const data = createDeferred<ArrayBuffer>();
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(data.promise);
    const iterator = socket.receive[Symbol.asyncIterator]();

    lastMockInstance.triggerMessage(blob);
    socket.close(1000, "owner done");
    await new Promise((resolve) => setTimeout(resolve, 0));
    data.resolve(encodeMessage({ ok: true, type: "pong" }));

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner done",
    });
  });

  test("should stop reconnect and heartbeat timers when disposed during reconnect delay", async () => {
    useFakeClock();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        heartbeat: { intervalMs: 50, message: () => ({ type: "ping" }) },
        retry: { maxRetries: 1, delayMs: 1_000 },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const firstSocket = lastMockInstance;
    expect(vi.getTimerCount()).toBe(1);

    firstSocket.triggerClose({ code: 1012, reason: "restart", wasClean: true });
    await vi.waitFor(() => expect(socket.state).toBe("reconnecting"));
    expect(vi.getTimerCount()).toBe(1);

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    expect(socket.state).toBe("closed");
    expectOnlyErrorSink(firstSocket);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockInstances).toHaveLength(1);
  });
});
