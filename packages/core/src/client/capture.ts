import type { BackoffConfig } from "../internal/backoff";
import type { ClientWebSocketOptions } from "./config";

/** Plain fixed-configuration record. Falsy values and non-objects pass through. */
function isShapeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ReconnectSnapshot<TCallback> = Partial<BackoffConfig> & {
  attempts?: number;
  connectTimeoutMs?: number;
  shouldReconnect?: TCallback;
};

/** Copies the known WebSocket heartbeat fields. Callbacks keep their identity. */
export function snapshotHeartbeat(
  value: ClientWebSocketOptions["heartbeat"],
): ClientWebSocketOptions["heartbeat"] {
  if (!isShapeRecord(value)) {
    return value;
  }
  return {
    intervalMs: value.intervalMs,
    isAck: value.isAck,
    message: value.message,
    timeoutMs: value.timeoutMs,
  };
}

/**
 * Copies the known reconnect fields shared by WebSocket and SSE policies.
 * `shouldReconnect` keeps its identity and is not called.
 */
export function snapshotReconnect<TCallback>(
  value: ReconnectSnapshot<TCallback> | undefined,
): ReconnectSnapshot<TCallback> | undefined {
  if (!isShapeRecord(value)) {
    return value;
  }
  return {
    attempts: value.attempts,
    connectTimeoutMs: value.connectTimeoutMs,
    delayMs: value.delayMs,
    factor: value.factor,
    jitter: value.jitter,
    maxDelayMs: value.maxDelayMs,
    shouldReconnect: value.shouldReconnect,
  };
}

/** Copies a protocols array. Any other runtime value is left for execution. */
export function snapshotProtocols(
  value: readonly string[] | undefined,
): readonly string[] | undefined {
  if (Array.isArray(value)) {
    return value.slice();
  }
  return value;
}
