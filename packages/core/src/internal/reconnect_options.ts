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
  const delayMs = config.delayMs ?? defaults.delayMs;
  const factor = config.factor ?? defaults.factor;
  const jitter = config.jitter ?? defaults.jitter;
  const maxDelayMs = config.maxDelayMs ?? defaults.maxDelayMs;
  assertFiniteRange("delayMs", delayMs, 0);
  assertFiniteRange("factor", factor, Number.MIN_VALUE);
  assertFiniteRange("jitter", jitter, 0, 1);
  if (maxDelayMs !== Number.POSITIVE_INFINITY)
    assertFiniteRange("maxDelayMs", maxDelayMs, 0);

  const connectTimeoutMs = config.connectTimeoutMs;
  if (connectTimeoutMs !== undefined)
    assertFiniteRange("connectTimeoutMs", connectTimeoutMs, Number.MIN_VALUE);
  return { attempts, delayMs, factor, jitter, maxDelayMs, connectTimeoutMs };

  function assertFiniteRange(
    field: string,
    value: number,
    minimum: number,
    maximum = Number.POSITIVE_INFINITY,
  ): void {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new RangeError(`${transport} reconnect ${field} is out of range`);
    }
  }
}
