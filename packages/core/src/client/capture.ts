import type { BackoffConfig } from "../internal/backoff";
import type { ClientWebSocketOptions, RetryOptions } from "./config";

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

function isProtocolList(
  value: readonly string[] | undefined,
): value is readonly string[] {
  return Array.isArray(value);
}

/** Copies a protocols array. Any other runtime value is left for execution. */
export function snapshotProtocols(
  value: readonly string[] | undefined,
): readonly string[] | undefined {
  if (isProtocolList(value)) {
    return value.slice();
  }
  return value;
}

/** Captures owned HTTP retry records and array containers without enabling an absent policy. */
export function snapshotRetry(
  value: RetryOptions | undefined,
): RetryOptions | undefined {
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return value;
  const {
    maxAttempts,
    on,
    methods,
    attemptTimeoutMs,
    delayMs,
    factor,
    jitter,
    maxDelayMs,
    budget,
  } = value;
  return {
    maxAttempts,
    on: isRetryList(on) ? [...on] : on,
    methods: isRetryList(methods) ? [...methods] : methods,
    attemptTimeoutMs,
    delayMs,
    factor,
    jitter,
    maxDelayMs,
    budget:
      budget !== undefined &&
      budget !== false &&
      budget !== null &&
      typeof budget === "object" &&
      !Array.isArray(budget)
        ? {
            percentCanRetry: budget.percentCanRetry,
            minRetriesPerSecond: budget.minRetriesPerSecond,
            ttlMs: budget.ttlMs,
          }
        : budget,
  };
}
function isRetryList<T>(
  value: readonly T[] | undefined,
): value is readonly T[] {
  return Array.isArray(value);
}
