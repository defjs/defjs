import type { ClientWebSocketOptions } from "../client/config";
import { normalizeReconnectOptions } from "../internal/reconnect_options";
import type { SocketLifecycleOutcome } from "./web_socket";

export type NormalizedReconnectConfig = {
  attempts: number;
  delayMs: number;
  factor: number;
  hasShouldReconnect: boolean;
  jitter: number;
  maxDelayMs: number;
  shouldReconnect: (
    outcome: SocketLifecycleOutcome,
    attempt: number,
  ) => boolean;
};

export function normalizeReconnectConfig(
  config: ClientWebSocketOptions["reconnect"] | undefined,
): NormalizedReconnectConfig | undefined {
  const reconnectPredicate = config?.shouldReconnect;
  const normalized = normalizeReconnectOptions(
    config,
    { delayMs: 1_000, factor: 2, jitter: 0, maxDelayMs: 30_000 },
    "WebSocket",
  );
  if (!normalized) {
    return undefined;
  }

  return {
    ...normalized,
    hasShouldReconnect: typeof reconnectPredicate === "function",
    shouldReconnect: (outcome, attempt) => {
      if (typeof reconnectPredicate === "function") {
        return Boolean(
          reconnectPredicate({
            attempt,
            cause: outcome.cause,
            code: outcome.closeInfo.code,
            reason: outcome.closeInfo.reason,
            wasClean: outcome.closeInfo.wasClean,
          }),
        );
      }

      return true;
    },
  };
}

export function shouldReconnect(
  config: NormalizedReconnectConfig | undefined,
  outcome: SocketLifecycleOutcome,
  attempt: number,
): boolean {
  if (!config) {
    return false;
  }

  if (outcome.opened === false && config.attempts <= 0) {
    return false;
  }

  return config.shouldReconnect(outcome, attempt);
}
