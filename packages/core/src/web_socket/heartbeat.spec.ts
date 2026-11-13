import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { struct } from "../struct";
import type { AnyStruct } from "../struct";
import type { HeartbeatRuntime } from "./heartbeat";
import { startHeartbeat } from "./heartbeat";
import type { WebSocketHeartbeatConfig } from "./web_socket";
import { createFakeWebSocket, FakeWebSocket } from "../../test/fake_web_socket";
import { useFakeClock } from "../../test/web_socket_support";

describe("heartbeat", () => {
  let runtimes: HeartbeatRuntime[];

  beforeEach(() => {
    runtimes = [];
    useFakeClock();
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

  /** An open socket that the test drives. A `Socket` from `createFakeWebSocket` can inject a fault. */
  function openSocket(
    Socket: typeof FakeWebSocket = createFakeWebSocket({
      handshake: "manual",
    }).Socket,
  ): FakeWebSocket {
    const socket = new Socket("wss://example.test");
    socket.open();
    return socket;
  }

  /** An open socket whose `send` records the frame and then runs `afterSend`. */
  function openSocketWith(afterSend: () => void): FakeWebSocket {
    const { Socket } = createFakeWebSocket({ handshake: "manual" });
    class Reentrant extends Socket {
      override send(data: Parameters<FakeWebSocket["send"]>[0]): void {
        super.send(data);
        afterSend();
      }
    }
    return openSocket(Reentrant);
  }

  function start(
    socket: FakeWebSocket,
    config: WebSocketHeartbeatConfig,
    outgoing?: AnyStruct,
    openState: number = FakeWebSocket.OPEN,
  ) {
    const onTimeout = vi.fn<(cause: Error) => void>();
    const onError = vi.fn<(cause: unknown) => void>();
    const runtime = startHeartbeat(
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
    const socket = openSocket();
    const message = vi.fn().mockReturnValue({ type: "ping" });

    start(
      socket,
      { intervalMs: 100, message },
      struct.object({ type: struct.literal("ping") }),
    );

    vi.advanceTimersByTime(200);
    expect(message).toHaveBeenCalledTimes(2);
    expect(socket.sent).toHaveLength(2);
  });

  test("should call the heartbeat message factory without a receiver", () => {
    const socket = openSocket();
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
    const socket = openSocket();
    let runtime: HeartbeatRuntime | undefined;
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
    expect(socket.sendCalls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should not arm an acknowledgement timeout when native send stops the runtime", () => {
    let runtime: HeartbeatRuntime | undefined;
    const socket = openSocketWith(() => runtime?.stop());

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
    expect(socket.sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(socket.sent).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test("F062 should accept an acknowledgement delivered synchronously by send on every heartbeat", () => {
    let runtime: HeartbeatRuntime | undefined;
    const socket = openSocketWith(() => runtime?.markAck());

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
    expect(socket.sent).toHaveLength(4);
    expect(socket.sentText(3)).toBe('{"type":"ping"}');
    expect(vi.getTimerCount()).toBe(1);
    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["ack", "stop"] as const)(
    "F062 should clean up when send performs %s and then throws",
    (action) => {
      let runtime: HeartbeatRuntime | undefined;
      const failure = new Error("send failed after reentry");
      const socket = openSocketWith(() => {
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
      expect(socket.sent).toHaveLength(1);
      expect(started.onError).toHaveBeenCalledTimes(action === "ack" ? 1 : 0);
      if (action === "ack")
        expect(started.onError).toHaveBeenCalledWith(failure);
      expect(started.onTimeout).not.toHaveBeenCalled();
    },
  );

  test("should skip heartbeat when socket is not open or message is undefined", () => {
    const { Socket } = createFakeWebSocket({ handshake: "manual" });
    const connecting = new Socket("wss://example.test");
    const open = openSocket();

    start(connecting, {
      intervalMs: 100,
      message: () => ({ type: "ping" }),
    });
    start(open, { intervalMs: 100, message: () => undefined });

    vi.advanceTimersByTime(100);
    expect(connecting.sendCalls).toEqual([]);
    expect(open.sendCalls).toEqual([]);
  });

  test("should report message factory, serialization, and native send failures as local errors", () => {
    for (const setup of [
      () => ({
        message: () => {
          throw new Error("factory failed");
        },
        outgoing: undefined,
        socket: openSocket(),
      }),
      () => ({
        message: () => ({ type: "unknown" }),
        outgoing: struct.object({ type: struct.literal("ping") }),
        socket: openSocket(),
      }),
      () => ({
        message: () => ({ type: "ping" as const }),
        outgoing: struct.object({ type: struct.literal("ping") }),
        socket: openSocketWith(() => {
          throw new Error("send failed");
        }),
      }),
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
    const socket = openSocket();

    const { onError } = start(
      socket,
      { intervalMs: 100, message: () => Number.POSITIVE_INFINITY },
      struct.number(),
    );

    vi.advanceTimersByTime(100);
    expect(socket.sendCalls).toEqual([]);
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
    const socket = openSocket();

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
    expect(socket.closeCalls).toEqual([]);
  });

  test("should not report a missing acknowledgement once the socket is no longer open", () => {
    // The peer's Close frame arrives while the ping is being sent.
    const socket: FakeWebSocket = openSocketWith(() => {
      socket.peerClosing();
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
    expect(socket.readyState).toBe(FakeWebSocket.CLOSING);
    expect(socket.sent).toHaveLength(1);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should keep one acknowledgement deadline when interval is shorter than timeout", () => {
    const socket = openSocket();

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
    expect(socket.sent).toHaveLength(1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith(
      new Error("WebSocket heartbeat timeout"),
    );

    vi.advanceTimersByTime(100);
    expect(socket.sent).toHaveLength(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  test("should clear timeout on ack and expose isAck", () => {
    const socket = openSocket();
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
    expect(socket.sent).toHaveLength(2);
    expect(isAck).toHaveBeenCalledWith("pong");
  });

  test("should stop heartbeat", () => {
    const socket = openSocket();

    const { runtime } = start(socket, {
      intervalMs: 100,
      message: () => ({ type: "ping" }),
    });
    runtime.stop();

    vi.advanceTimersByTime(100);
    expect(socket.sendCalls).toEqual([]);
  });

  test("should use the injected constructor open state when global WebSocket is unavailable", () => {
    const socket = openSocket();
    vi.stubGlobal("WebSocket", undefined);

    const { onError, onTimeout } = start(
      socket,
      { intervalMs: 100, message: () => ({ type: "ping" as const }) },
      struct.object({ type: struct.literal("ping") }),
      1,
    );
    vi.advanceTimersByTime(100);

    expect(socket.sent).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
