import type { WebSocketHandle } from "../client/config";
import type { AnyStruct } from "../struct";
import { serializeOutgoingWebSocketMessage } from "./codec";
import type { WebSocketHeartbeatConfig } from "./web_socket";

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
  config: WebSocketHeartbeatConfig | undefined,
  outgoing: TOutgoing | undefined,
  /** `timedOut` is true only when the peer left a heartbeat unacknowledged; other failures are local. */
  onFatal: (error: unknown, timedOut: boolean) => void,
  openState: number,
): void {
  stopHeartbeat(sessionController);
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
      const nextMessage = message();
      if (!isActive() || typeof nextMessage === "undefined") {
        return;
      }
      const serialized = serializeOutgoingWebSocketMessage(
        outgoing,
        nextMessage,
      );
      if (!isActive()) {
        return;
      }
      if (config.timeoutMs !== undefined) {
        ackTimer = setTimeout(() => {
          fail(new Error("WebSocket heartbeat timeout"), true);
        }, config.timeoutMs);
      }
      socket.send(serialized);
    } catch (error) {
      fail(error, false);
    }
  }, config.intervalMs);

  function fail(error: unknown, timedOut: boolean): void {
    runtime.stop();
    /* istanbul ignore if -- @preserve defensive: a cleared platform timeout callback may already be queued when the runtime stops */
    if (!isActive()) {
      return;
    }
    sessionController.heartbeat = undefined;
    onFatal(error, timedOut);
  }
}

export function stopHeartbeat<T>(sessionController: {
  heartbeat: HeartbeatRuntime<T> | undefined;
}): void {
  sessionController.heartbeat?.stop();
  sessionController.heartbeat = undefined;
}
