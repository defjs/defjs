import type { BackoffConfig } from "./backoff";

type ReconnectOptions = Partial<BackoffConfig> & {
  attempts?: number;
  connectTimeoutMs?: number;
};

export function normalizeReconnectOptions(
  config: ReconnectOptions | undefined,
  defaults: BackoffConfig,
  transport: "SSE" | "WebSocket",
):
  | (BackoffConfig & { attempts: number; connectTimeoutMs?: number })
  | undefined {
  if (!config) return undefined;

  const attempts = config.attempts ?? 3;
  if (!Number.isSafeInteger(attempts) || attempts < 0) {
    throw new RangeError(
      `${transport} reconnect attempts must be a non-negative safe integer`,
    );
  }
  const { delayMs, factor, jitter, maxDelayMs } = normalizeBackoffOptions(
    config,
    defaults,
    `${transport} reconnect`,
  );
  const connectTimeoutMs = config.connectTimeoutMs;
  if (connectTimeoutMs !== undefined)
    assertFiniteRange(
      `${transport} reconnect`,
      "connectTimeoutMs",
      connectTimeoutMs,
      Number.MIN_VALUE,
      2_147_483_647,
    );
  return { attempts, delayMs, factor, jitter, maxDelayMs, connectTimeoutMs };
}

export function normalizeBackoffOptions(
  config: Partial<BackoffConfig>,
  defaults: BackoffConfig,
  label: string,
): BackoffConfig {
  const delayMs = config.delayMs ?? defaults.delayMs;
  const factor = config.factor ?? defaults.factor;
  const jitter = config.jitter ?? defaults.jitter;
  const maxDelayMs = config.maxDelayMs ?? defaults.maxDelayMs;
  assertFiniteRange(label, "delayMs", delayMs, 0);
  assertFiniteRange(label, "factor", factor, Number.MIN_VALUE);
  assertFiniteRange(label, "jitter", jitter, 0, 1);
  if (maxDelayMs !== Number.POSITIVE_INFINITY)
    assertFiniteRange(label, "maxDelayMs", maxDelayMs, 0);

  return { delayMs, factor, jitter, maxDelayMs };
}
function assertFiniteRange(
  label: string,
  field: string,
  value: number,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} ${field} is out of range`);
  }
}
