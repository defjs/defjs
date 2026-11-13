import type { WebSocketHandle } from "../client/config";
import type { AnyStruct } from "../struct";
import { serializeOutgoingWebSocketMessage } from "./codec";
import type { WebSocketHeartbeatConfig } from "./web_socket";

export type HeartbeatRuntime = {
  readonly isAck: ((message: unknown) => boolean) | undefined;
  markAck(): void;
  stop(): void;
};

/**
 * Starts the heartbeat of one physical socket. The caller owns the returned runtime and stops it when the socket
 * ends; a runtime also stops itself once it has reported a failure.
 *
 * `onTimeout` receives a heartbeat the peer left unanswered, a connection failure. `onError` receives a local
 * failure: the message factory, the encoding or the native send threw. Neither is called once the runtime has stopped
 * or the socket is no longer open.
 */
export function startHeartbeat(
  socket: WebSocketHandle,
  openState: number,
  config: WebSocketHeartbeatConfig,
  outgoing: AnyStruct | undefined,
  onTimeout: (cause: Error) => void,
  onError: (cause: unknown) => void,
): HeartbeatRuntime {
  let stopped = false;
  let ackTimer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const runtime: HeartbeatRuntime = {
    isAck: config.isAck,
    markAck() {
      clearTimeout(ackTimer);
      ackTimer = undefined;
    },
    stop() {
      stopped = true;
      clearInterval(interval);
      clearTimeout(ackTimer);
      interval = undefined;
      ackTimer = undefined;
    },
  };
  const isActive = () => !stopped && socket.readyState === openState;
  // A failure ends the runtime. It is reported only while it still counts: a stop, or a socket that is
  // already closing, leaves the end of the attempt to the close event.
  const endIfActive = (): boolean => {
    const active = isActive();
    runtime.stop();
    return active;
  };

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
          if (endIfActive()) {
            onTimeout(new Error("WebSocket heartbeat timeout"));
          }
        }, config.timeoutMs);
      }
      socket.send(serialized);
    } catch (error) {
      if (endIfActive()) {
        onError(error);
      }
    }
  }, config.intervalMs);
  return runtime;
}
