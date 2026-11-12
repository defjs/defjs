import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { WebSocketHandle } from "../client/config";
import { struct } from "../struct";
import type { AnyStruct } from "../struct";
import type { HeartbeatRuntime } from "./heartbeat";
import { startHeartbeat } from "./heartbeat";
import type { WebSocketHeartbeatConfig } from "./web_socket";
import { method } from "../../test/method";

describe("heartbeat", () => {
  let runtimes: HeartbeatRuntime<unknown>[];

  beforeEach(() => {
    runtimes = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    const errors: unknown[] = [];
    for (const runtime of runtimes) {
      try {
        runtime.stop();
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

  function start(
    socket: WebSocketHandle,
    config: WebSocketHeartbeatConfig,
    outgoing?: AnyStruct,
    openState: number = WebSocket.OPEN,
  ) {
    const onTimeout = vi.fn<(cause: Error) => void>();
    const onError = vi.fn<(cause: unknown) => void>();
    const runtime = startHeartbeat<unknown, AnyStruct | undefined>(
      socket,
      openState,
      config,
      outgoing,
      onTimeout,
      onError,
    );
    runtimes.push(runtime);
    return { onError, onTimeout, runtime };
  }

  test("should send heartbeat messages at the configured interval", () => {
    const socket = createMockSocket();
    const message = vi.fn().mockReturnValue({ type: "ping" });

    start(
      socket,
      { intervalMs: 100, message },
      struct.object({ type: struct.literal("ping") }),
    );

    vi.advanceTimersByTime(200);
    expect(message).toHaveBeenCalledTimes(2);
    expect(method(socket, "send")).toHaveBeenCalledTimes(2);
  });

  test("should call the heartbeat message factory without a receiver", () => {
    const socket = createMockSocket();
    function message(this: unknown) {
      expect(this).toBeUndefined();
      return { type: "ping" as const };
    }

    const { onError, onTimeout } = start(
      socket,
      { intervalMs: 100, message },
      struct.object({ type: struct.literal("ping") }),
    );

    vi.advanceTimersByTime(100);
    expect(onError).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test("should not send when outgoing serialization stops the runtime", () => {
    const socket = createMockSocket();
    let runtime: HeartbeatRuntime<unknown> | undefined;
    const message = {
      get text() {
        runtime?.stop();
        return "late";
      },
      type: "ping" as const,
    };

    ({ runtime } = start(
      socket,
      {
        intervalMs: 100,
        message: () => message,
        isAck: () => false,
        timeoutMs: 200,
      },
      struct.object({ type: struct.literal("ping"), text: struct.string() }),
    ));

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should not arm an acknowledgement timeout when native send stops the runtime", () => {
    const socket = createMockSocket();
    let runtime: HeartbeatRuntime<unknown> | undefined;
    socket.send = vi.fn(() => runtime?.stop());

    const { onError, onTimeout, ...started } = start(
      socket,
      {
        intervalMs: 100,
        message: () => ({ type: "ping" as const }),
        isAck: () => false,
        timeoutMs: 200,
      },
      struct.object({ type: struct.literal("ping") }),
    );
    runtime = started.runtime;

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test("F062 should accept an acknowledgement delivered synchronously by send on every heartbeat", () => {
    const socket = createMockSocket();
    let runtime: HeartbeatRuntime<unknown> | undefined;
    socket.send = vi.fn(() => runtime?.markAck());

    const started = start(
      socket,
      {
        intervalMs: 100,
        timeoutMs: 50,
        isAck: () => false,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
    );
    runtime = started.runtime;

    vi.advanceTimersByTime(450);

    expect(started.onError).not.toHaveBeenCalled();
    expect(started.onTimeout).not.toHaveBeenCalled();
    expect(method(socket, "send")).toHaveBeenCalledTimes(4);
    expect(method(socket, "send")).toHaveBeenLastCalledWith('{"type":"ping"}');
    expect(vi.getTimerCount()).toBe(1);
    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["ack", "stop"] as const)(
    "F062 should clean up when send performs %s and then throws",
    (action) => {
      const socket = createMockSocket();
      let runtime: HeartbeatRuntime<unknown> | undefined;
      const failure = new Error("send failed after reentry");
      socket.send = vi.fn(() => {
        if (action === "ack") runtime?.markAck();
        else runtime?.stop();
        throw failure;
      });

      const started = start(
        socket,
        {
          intervalMs: 100,
          timeoutMs: 50,
          isAck: () => false,
          message: () => ({ type: "ping" as const }),
        },
        struct.object({ type: struct.literal("ping") }),
      );
      runtime = started.runtime;

      vi.advanceTimersByTime(100);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1_000);
      expect(method(socket, "send")).toHaveBeenCalledOnce();
      expect(started.onError).toHaveBeenCalledTimes(action === "ack" ? 1 : 0);
      if (action === "ack")
        expect(started.onError).toHaveBeenCalledWith(failure);
      expect(started.onTimeout).not.toHaveBeenCalled();
    },
  );

  test("should skip heartbeat when socket is not open or message is undefined", () => {
    const closedSocket = createMockSocket(WebSocket.CONNECTING);
    const openSocket = createMockSocket();

    start(closedSocket, {
      intervalMs: 100,
      message: () => ({ type: "ping" }),
    });
    start(openSocket, { intervalMs: 100, message: () => undefined });

    vi.advanceTimersByTime(100);
    expect(method(closedSocket, "send")).not.toHaveBeenCalled();
    expect(method(openSocket, "send")).not.toHaveBeenCalled();
  });

  test("should report message factory, serialization, and native send failures as local errors", () => {
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
      const { message, outgoing, socket } = setup();
      const { onError, onTimeout } = start(
        socket,
        { intervalMs: 100, timeoutMs: 200, isAck: () => false, message },
        outgoing,
      );
      vi.advanceTimersByTime(100);
      expect(onError).toHaveBeenCalledTimes(1);
      // A local failure is never reported as an unanswered heartbeat.
      expect(onTimeout).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1_000);
      expect(onError).toHaveBeenCalledTimes(1);
    }
  });

  test("should reject a non-JSON heartbeat payload before the socket send", () => {
    const socket = createMockSocket();

    const { onError } = start(
      socket,
      { intervalMs: 100, message: () => Number.POSITIVE_INFINITY },
      struct.number(),
    );

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
    const messageMatcher: unknown = expect.stringContaining(
      "is not JSON data: Infinity",
    );
    expect(onError.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ message: messageMatcher }),
    );
  });

  test("should report timeout without owning socket close or queues", () => {
    const socket = createMockSocket();

    const { onError, onTimeout } = start(
      socket,
      {
        intervalMs: 100,
        timeoutMs: 50,
        isAck: () => false,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
    );

    vi.advanceTimersByTime(150);
    expect(onTimeout).toHaveBeenCalledWith(
      new Error("WebSocket heartbeat timeout"),
    );
    expect(onError).not.toHaveBeenCalled();
    expect(method(socket, "close")).not.toHaveBeenCalled();
  });

  test("should not report a missing acknowledgement once the socket is no longer open", () => {
    const socket = createMockSocket();
    let readyState: number = WebSocket.OPEN;
    Object.defineProperty(socket, "readyState", { get: () => readyState });
    socket.send = vi.fn(() => {
      readyState = WebSocket.CLOSING;
    });

    const { onError, onTimeout } = start(
      socket,
      {
        intervalMs: 100,
        timeoutMs: 50,
        isAck: () => false,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
    );

    vi.advanceTimersByTime(150);
    expect(method(socket, "send")).toHaveBeenCalledOnce();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should keep one acknowledgement deadline when interval is shorter than timeout", () => {
    const socket = createMockSocket();

    const { onTimeout } = start(
      socket,
      {
        intervalMs: 5,
        timeoutMs: 20,
        isAck: () => false,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
    );

    vi.advanceTimersByTime(24);
    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith(
      new Error("WebSocket heartbeat timeout"),
    );

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  test("should clear timeout on ack and expose isAck", () => {
    const socket = createMockSocket();
    const isAck = vi.fn().mockReturnValue(true);

    const { onError, onTimeout, runtime } = start(
      socket,
      {
        intervalMs: 100,
        isAck,
        timeoutMs: 200,
        message: () => ({ type: "ping" as const }),
      },
      struct.object({ type: struct.literal("ping") }),
    );

    vi.advanceTimersByTime(100);
    expect(runtime.isAck?.("pong")).toBe(true);
    runtime.markAck();
    vi.advanceTimersByTime(200);
    expect(onError).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(method(socket, "send")).toHaveBeenCalledTimes(2);
    expect(isAck).toHaveBeenCalledWith("pong");
  });

  test("should stop heartbeat", () => {
    const socket = createMockSocket();

    const { runtime } = start(socket, {
      intervalMs: 100,
      message: () => ({ type: "ping" }),
    });
    runtime.stop();

    vi.advanceTimersByTime(100);
    expect(method(socket, "send")).not.toHaveBeenCalled();
  });

  test("should use the injected constructor open state when global WebSocket is unavailable", () => {
    const socket = createMockSocket(1);
    vi.stubGlobal("WebSocket", undefined);

    const { onError, onTimeout } = start(
      socket,
      { intervalMs: 100, message: () => ({ type: "ping" as const }) },
      struct.object({ type: struct.literal("ping") }),
      1,
    );
    vi.advanceTimersByTime(100);

    expect(method(socket, "send")).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
