import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { WebSocketHandle } from "../client/config";
import { struct } from "../struct";
import type { HeartbeatSession } from "./heartbeat";
import {
  startHeartbeat,
  stopHeartbeat,
  validateHeartbeatConfig,
} from "./heartbeat";
import { method } from "../../test/method";

describe("heartbeat", () => {
  let sessions: HeartbeatSession<unknown>[];

  beforeEach(() => {
    sessions = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    const errors: unknown[] = [];
    for (const session of sessions) {
      try {
        stopHeartbeat(session);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      const remainingTimers = vi.getTimerCount();
      if (remainingTimers !== 0) {
        throw new Error(
          `Heartbeat timers remaining after stop: ${remainingTimers}`,
        );
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      vi.useRealTimers();
    } catch (error) {
      errors.push(error);
    }
    try {
      vi.unstubAllGlobals();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Heartbeat test cleanup failed");
    }
  });

  function createMockSocket(
    readyState: number = WebSocket.OPEN,
  ): WebSocketHandle {
    return {
      addEventListener: vi.fn(),
      bufferedAmount: 0,
      close: vi.fn(),
      extensions: "",
      protocol: "",
      readyState,
      removeEventListener: vi.fn(),
      send: vi.fn(),
      url: "",
    };
  }

  function createMockSession(
    currentSocket?: WebSocketHandle,
  ): HeartbeatSession<unknown> {
    const session: HeartbeatSession<unknown> = {
      currentSocket,
      heartbeat: undefined,
    };
    sessions.push(session);
    return session;
  }

  test.each([
    ["intervalMs", { intervalMs: 0 }],
    ["intervalMs", { intervalMs: -1 }],
    ["intervalMs", { intervalMs: Number.NaN }],
    ["intervalMs", { intervalMs: Number.POSITIVE_INFINITY }],
    ["intervalMs", { intervalMs: 2_147_483_648 }],
    ["timeoutMs", { intervalMs: 100, timeoutMs: 0 }],
    ["timeoutMs", { intervalMs: 100, timeoutMs: Number.POSITIVE_INFINITY }],
    ["timeoutMs", { intervalMs: 100, timeoutMs: 2_147_483_648 }],
  ])(
    "should reject invalid %s before creating a platform timer",
    (field, config) => {
      expect(() => validateHeartbeatConfig(config)).toThrow(
        `WebSocket heartbeat ${field}`,
      );
    },
  );

  test("should accept the maximum platform timer delay", () => {
    expect(() =>
      validateHeartbeatConfig({
        intervalMs: 2_147_483_647,
        timeoutMs: 2_147_483_647,
      }),
    ).not.toThrow();
  });

  test("should do nothing when config is undefined", () => {
    const session = createMockSession();
    startHeartbeat(
      createMockSocket(),
      session,
      undefined,
      undefined,
      vi.fn(),
      WebSocket.OPEN,
    );
    expect(session.heartbeat).toBeUndefined();
  });

  test("should stop existing heartbeat before starting new one", () => {
    const session = createMockSession();
    const existingHeartbeat = {
      isAck: undefined,
      markAck: vi.fn(),
      stop: vi.fn(),
    };
    session.heartbeat = existingHeartbeat;

    startHeartbeat(
      createMockSocket(),
      session,
      { intervalMs: 1000 },
      undefined,
      vi.fn(),
      WebSocket.OPEN,
    );

    expect(existingHeartbeat.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    stopHeartbeat(session);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should send heartbeat messages at the configured interval", () => {
    const socket = createMockSocket();
    const session = createMockSession(socket);
    const message = vi.fn().mockReturnValue({ type: "ping" });

    startHeartbeat(
      socket,
      session,
      { intervalMs: 100, message },
      struct.object({ type: struct.literal("ping") }),
      vi.fn(),
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(200);
    expect(message).toHaveBeenCalledTimes(2);
    expect(method(socket, "send")).toHaveBeenCalledTimes(2);
  });

  test("should call the heartbeat message factory without a receiver", () => {
    const socket = createMockSocket();
    const session = createMockSession(socket);
    const onFatal = vi.fn();
    function message(this: unknown) {
      expect(this).toBeUndefined();
      return { type: "ping" as const };
    }

    startHeartbeat(
      socket,
      session,
      { intervalMs: 100, message },
      struct.object({ type: struct.literal("ping") }),
      onFatal,
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(100);
    expect(onFatal).not.toHaveBeenCalled();
  });

  test("should ignore a falsy non-function heartbeat message at the runtime boundary", () => {
    const socket = createMockSocket();
    const session = createMockSession(socket);
    const onFatal = vi.fn();

    startHeartbeat(
      socket,
      session,
      {
        intervalMs: 100,
        // @ts-expect-error non-function message is ignored at runtime
        message: false,
      },
      undefined,
      onFatal,
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).not.toHaveBeenCalled();
    expect(onFatal).not.toHaveBeenCalled();
  });

  test("should not send when outgoing serialization stops the active heartbeat runtime", () => {
    const socket = createMockSocket();
    const session = createMockSession(socket);
    const message = {
      get text() {
        stopHeartbeat(session);
        return "late";
      },
      type: "ping" as const,
    };

    startHeartbeat(
      socket,
      session,
      { intervalMs: 100, message: () => message, timeoutMs: 200 },
      struct.object({ type: struct.literal("ping"), text: struct.string() }),
      vi.fn(),
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should not arm an acknowledgement timeout when native send stops the active heartbeat runtime", () => {
    const socket = createMockSocket();
    const session = createMockSession(socket);
    const onFatal = vi.fn();
    socket.send = vi.fn(() => stopHeartbeat(session));

    startHeartbeat(
      socket,
      session,
      {
        intervalMs: 100,
        message: () => ({ type: "ping" as const }),
        timeoutMs: 200,
      },
      struct.object({ type: struct.literal("ping") }),
      onFatal,
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(session.heartbeat).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(onFatal).not.toHaveBeenCalled();
  });

  test("F062 should accept an acknowledgement delivered synchronously by send on every heartbeat", () => {
    const socket = createMockSocket();
    const session = createMockSession(socket);
    const onFatal = vi.fn();
    socket.send = vi.fn(() => session.heartbeat?.markAck());

    startHeartbeat(
      socket,
      session,
      {
        intervalMs: 100,
        timeoutMs: 50,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
      onFatal,
      WebSocket.OPEN,
    );
    const runtime = session.heartbeat;

    vi.advanceTimersByTime(450);

    expect(onFatal).not.toHaveBeenCalled();
    expect(method(socket, "send")).toHaveBeenCalledTimes(4);
    expect(method(socket, "send")).toHaveBeenLastCalledWith('{"type":"ping"}');
    expect(session.heartbeat).toBe(runtime);
    expect(vi.getTimerCount()).toBe(1);
    stopHeartbeat(session);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["ack", "stop"] as const)(
    "F062 should clean up when send performs %s and then throws",
    (action) => {
      const socket = createMockSocket();
      const session = createMockSession(socket);
      const onFatal = vi.fn();
      const failure = new Error("send failed after reentry");
      socket.send = vi.fn(() => {
        if (action === "ack") session.heartbeat?.markAck();
        else stopHeartbeat(session);
        throw failure;
      });

      startHeartbeat(
        socket,
        session,
        {
          intervalMs: 100,
          timeoutMs: 50,
          message: () => ({ type: "ping" as const }),
        },
        struct.object({ type: struct.literal("ping") }),
        onFatal,
        WebSocket.OPEN,
      );

      vi.advanceTimersByTime(100);
      expect(session.heartbeat).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1_000);
      expect(method(socket, "send")).toHaveBeenCalledOnce();
      expect(onFatal).toHaveBeenCalledTimes(action === "ack" ? 1 : 0);
      if (action === "ack") expect(onFatal).toHaveBeenCalledWith(failure);
    },
  );

  test.each([false, true])(
    "F062 should preserve the replacement runtime when the old send throws = %s",
    (throws) => {
      const socket = createMockSocket();
      const session = createMockSession(socket);
      const onFatal = vi.fn();
      const replacementFatal = vi.fn();
      const config = {
        intervalMs: 100,
        timeoutMs: 50,
        message: () => ({ type: "ping" as const }),
      };
      const outgoing = struct.object({ type: struct.literal("ping") });
      socket.send = vi.fn().mockImplementationOnce(() => {
        startHeartbeat(
          socket,
          session,
          config,
          outgoing,
          replacementFatal,
          WebSocket.OPEN,
        );
        if (throws) throw new Error("stale send failed");
      });
      startHeartbeat(
        socket,
        session,
        config,
        outgoing,
        onFatal,
        WebSocket.OPEN,
      );
      const previousRuntime = session.heartbeat;

      vi.advanceTimersByTime(100);
      const runtime = session.heartbeat;
      expect(runtime).toBeDefined();
      expect(runtime).not.toBe(previousRuntime);
      expect(session.currentSocket).toBe(socket);
      expect(method(socket, "send")).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(1);

      for (let count = 1; count <= 3; count += 1) {
        vi.advanceTimersByTime(100);
        expect(method(socket, "send")).toHaveBeenCalledTimes(count + 1);
        expect(vi.getTimerCount()).toBe(2);
        runtime?.markAck();
        expect(vi.getTimerCount()).toBe(1);
        expect(session.heartbeat).toBe(runtime);
      }
      expect(onFatal).not.toHaveBeenCalled();
      expect(replacementFatal).not.toHaveBeenCalled();
      stopHeartbeat(session);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test("should skip heartbeat when socket is not open or message is undefined", () => {
    const closedSocket = createMockSocket(WebSocket.CONNECTING);
    const openSocket = createMockSocket();
    const closedSession = createMockSession(closedSocket);
    const openSession = createMockSession(openSocket);

    startHeartbeat(
      closedSocket,
      closedSession,
      { intervalMs: 100, message: () => ({ type: "ping" }) },
      undefined,
      vi.fn(),
      WebSocket.OPEN,
    );
    startHeartbeat(
      openSocket,
      openSession,
      { intervalMs: 100 },
      undefined,
      vi.fn(),
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(100);
    expect(method(closedSocket, "send")).not.toHaveBeenCalled();
    expect(method(openSocket, "send")).not.toHaveBeenCalled();
  });

  test("should report message factory, serialization, and native send failures as fatal", () => {
    for (const setup of [
      () => ({
        message: () => {
          throw new Error("factory failed");
        },
        outgoing: undefined,
        socket: createMockSocket(),
      }),
      () => ({
        message: () => ({ type: "unknown" }),
        outgoing: struct.object({ type: struct.literal("ping") }),
        socket: createMockSocket(),
      }),
      () => {
        const socket = createMockSocket();
        socket.send = vi.fn(() => {
          throw new Error("send failed");
        });
        return {
          message: () => ({ type: "ping" as const }),
          outgoing: struct.object({ type: struct.literal("ping") }),
          socket,
        };
      },
    ]) {
      const onFatal = vi.fn();
      const { message, outgoing, socket } = setup();
      const session = createMockSession(socket);
      startHeartbeat(
        socket,
        session,
        { intervalMs: 100, timeoutMs: 200, message },
        outgoing,
        onFatal,
        WebSocket.OPEN,
      );
      vi.advanceTimersByTime(100);
      expect(onFatal).toHaveBeenCalledTimes(1);
      expect(session.heartbeat).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1_000);
      expect(onFatal).toHaveBeenCalledTimes(1);
    }
  });

  test("should reject a non-JSON heartbeat payload before the socket send", () => {
    const socket = createMockSocket();
    const onFatal = vi.fn<(error: unknown) => void>();

    startHeartbeat(
      socket,
      createMockSession(socket),
      { intervalMs: 100, message: () => Number.POSITIVE_INFINITY },
      struct.number(),
      onFatal,
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).not.toHaveBeenCalled();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
    expect(onFatal.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- INTENT: preserve the original asymmetric matcher for the fatal observer argument
        message: expect.stringContaining("is not JSON data: Infinity"),
      }),
    );
  });

  test("should report timeout without owning socket close or queues", () => {
    const socket = createMockSocket();
    const onFatal = vi.fn();
    const session = createMockSession(socket);

    startHeartbeat(
      socket,
      session,
      {
        intervalMs: 100,
        timeoutMs: 50,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
      onFatal,
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(150);
    expect(onFatal).toHaveBeenCalledWith(
      new Error("WebSocket heartbeat timeout"),
    );
  });

  test("should keep one acknowledgement deadline when interval is shorter than timeout", () => {
    const socket = createMockSocket();
    const onFatal = vi.fn();
    const session = createMockSession(socket);

    startHeartbeat(
      socket,
      session,
      {
        intervalMs: 5,
        timeoutMs: 20,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
      onFatal,
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(24);
    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(onFatal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFatal).toHaveBeenCalledOnce();
    expect(onFatal).toHaveBeenCalledWith(
      new Error("WebSocket heartbeat timeout"),
    );

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledOnce();
  });

  test("should clear timeout on ack and expose isAck", () => {
    const socket = createMockSocket();
    const onFatal = vi.fn();
    const session = createMockSession(socket);
    const isAck = vi.fn().mockReturnValue(true);

    startHeartbeat(
      socket,
      session,
      {
        intervalMs: 100,
        isAck,
        timeoutMs: 200,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
      onFatal,
      WebSocket.OPEN,
    );

    vi.advanceTimersByTime(100);
    expect(session.heartbeat?.isAck?.("pong")).toBe(true);
    session.heartbeat?.markAck();
    vi.advanceTimersByTime(200);
    expect(onFatal).not.toHaveBeenCalled();
    expect(method(socket, "send")).toHaveBeenCalledTimes(2);
    expect(isAck).toHaveBeenCalledWith("pong");
  });

  test("should stop heartbeat", () => {
    const socket = createMockSocket();
    const session = createMockSession(socket);

    startHeartbeat(
      socket,
      session,
      { intervalMs: 100, message: () => ({ type: "ping" }) },
      undefined,
      vi.fn(),
      WebSocket.OPEN,
    );
    stopHeartbeat(session);

    expect(session.heartbeat).toBeUndefined();
    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).not.toHaveBeenCalled();
  });

  test("should use the injected constructor open state when global WebSocket is unavailable", () => {
    const socket = createMockSocket(1);
    const onFatal = vi.fn();
    vi.stubGlobal("WebSocket", undefined);

    startHeartbeat(
      socket,
      createMockSession(socket),
      { intervalMs: 100, message: () => ({ type: "ping" as const }) },
      struct.object({ type: struct.literal("ping") }),
      onFatal,
      1,
    );
    vi.advanceTimersByTime(100);

    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(onFatal).not.toHaveBeenCalled();
  });
});
