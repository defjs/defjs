import type { WebSocketHandle } from "../client/config";
import type { AnyStruct } from "../struct";
import { serializeOutgoingWebSocketMessage } from "./codec";
import type {
  WebSocketHeartbeatConfig,
  WebSocketOutgoingData,
} from "./web_socket";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type HeartbeatRuntime<TIncoming> = {
  isAck?: (message: TIncoming) => boolean;
  markAck(): void;
  stop(): void;
};

export type HeartbeatSession<TIncoming> = {
  currentSocket: WebSocketHandle | undefined;
  heartbeat: HeartbeatRuntime<TIncoming> | undefined;
};

export function startHeartbeat<
  TIncoming,
  TOutgoing extends AnyStruct | undefined,
>(
  socket: WebSocketHandle,
  sessionController: HeartbeatSession<TIncoming>,
  config:
    | WebSocketHeartbeatConfig<TIncoming, WebSocketOutgoingData<TOutgoing>>
    | undefined,
  outgoing: TOutgoing | undefined,
  onFatal: (error: unknown) => void,
  openState: number,
): void {
  stopHeartbeat(sessionController);
  validateHeartbeatConfig(config);
  if (!config) {
    return;
  }

  let ackTimer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const runtime: HeartbeatRuntime<TIncoming> = {
    isAck: config.isAck,
    markAck() {
      clearTimeout(ackTimer);
      ackTimer = undefined;
    },
    stop() {
      clearInterval(interval);
      clearTimeout(ackTimer);
      interval = undefined;
      ackTimer = undefined;
    },
  };
  const isActive = () =>
    sessionController.heartbeat === runtime &&
    sessionController.currentSocket === socket &&
    socket.readyState === openState;

  sessionController.heartbeat = runtime;
  interval = setInterval(() => {
    if (!isActive()) {
      return;
    }
    if (typeof ackTimer !== "undefined") {
      return;
    }

    try {
      const message = config.message;
      const nextMessage = message ? message() : undefined;
      if (!isActive() || typeof nextMessage === "undefined") {
        return;
      }
      const serialized = serializeOutgoingWebSocketMessage(
        outgoing,
        nextMessage as WebSocketOutgoingData<TOutgoing>,
      );
      if (!isActive()) {
        return;
      }
      if (typeof config.timeoutMs === "number" && config.timeoutMs > 0) {
        ackTimer = setTimeout(() => {
          fail(new Error("WebSocket heartbeat timeout"));
        }, config.timeoutMs);
      }
      socket.send(serialized);
    } catch (error) {
      fail(error);
    }
  }, config.intervalMs);

  function fail(error: unknown): void {
    runtime.stop();
    /* istanbul ignore if -- @preserve defensive: a cleared platform timeout callback may already be queued when the runtime stops */
    if (!isActive()) {
      return;
    }
    sessionController.heartbeat = undefined;
    onFatal(error);
  }
}

export function validateHeartbeatConfig(
  config: { intervalMs: number; timeoutMs?: number } | undefined,
): void {
  if (!config) {
    return;
  }
  assertTimerDelay("intervalMs", config.intervalMs);
  if (typeof config.timeoutMs !== "undefined") {
    assertTimerDelay("timeoutMs", config.timeoutMs);
  }
}

export function stopHeartbeat<T>(sessionController: {
  heartbeat: HeartbeatRuntime<T> | undefined;
}): void {
  sessionController.heartbeat?.stop();
  sessionController.heartbeat = undefined;
}

function assertTimerDelay(field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      `WebSocket heartbeat ${field} must be between 0 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
}
