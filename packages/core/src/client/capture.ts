import type { WebSocketHeartbeatConfig } from "../web_socket/web_socket";
import type { RetryOptions } from "./config";

/**
 * Copies the known WebSocket heartbeat fields. Callbacks keep their identity.
 * Each field is read once, so a getter runs when the option is applied.
 */
export function snapshotHeartbeat(
  value: WebSocketHeartbeatConfig | undefined,
): WebSocketHeartbeatConfig | undefined {
  if (value === undefined) {
    return value;
  }
  const { intervalMs, isAck, message, timeoutMs } = value;
  // The union ties `isAck` to `timeoutMs`, so each return is built from the member that the check narrowed.
  if (timeoutMs === undefined) {
    return { intervalMs, isAck, message, timeoutMs };
  }
  return { intervalMs, isAck, message, timeoutMs };
}

/** Copies a protocols array. */
export function snapshotProtocols(
  value: readonly string[] | undefined,
): readonly string[] | undefined {
  return value?.slice();
}

/** Captures the owned parts of a retry policy: the methods array and the budget record are copied. Callbacks keep their identity. */
export function snapshotRetry(
  value: RetryOptions | undefined,
): RetryOptions | undefined {
  if (value === undefined) return value;
  const {
    maxRetries,
    delayMs,
    factor,
    maxDelayMs,
    jitter,
    attemptTimeoutMs,
    methods,
    shouldRetry,
    budget,
  } = value;
  return {
    maxRetries,
    delayMs,
    factor,
    maxDelayMs,
    jitter,
    attemptTimeoutMs,
    methods: methods?.slice(),
    shouldRetry,
    budget:
      budget === undefined || budget === false
        ? budget
        : {
            percentCanRetry: budget.percentCanRetry,
            minRetriesPerSecond: budget.minRetriesPerSecond,
            ttlMs: budget.ttlMs,
          },
  };
}
