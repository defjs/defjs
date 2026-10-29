const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type BackoffConfig = {
  delayMs: number;
  factor: number;
  jitter: number;
  maxDelayMs: number;
};

export function computeReconnectDelay(
  config: BackoffConfig,
  attempt: number,
): number {
  // SSE can replace the normalized base with onerror's delay or retryInterval.
  if (!Number.isFinite(config.delayMs)) {
    throw new RangeError("Reconnect delay must be finite");
  }

  const exponential =
    config.delayMs === 0
      ? 0
      : Math.min(
          config.delayMs * config.factor ** Math.max(0, attempt - 1),
          config.maxDelayMs,
          Number.MAX_VALUE,
        );
  const delay =
    config.jitter <= 0
      ? exponential
      : Math.max(
          0,
          Math.round(
            exponential * (1 + (Math.random() * 2 - 1) * config.jitter),
          ),
        );
  return Math.min(delay, config.maxDelayMs, MAX_TIMER_DELAY_MS);
}

export async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms)) {
    throw new RangeError("Reconnect delay must be finite");
  }
  if (ms <= 0) {
    return;
  }

  const delay = Math.min(ms, MAX_TIMER_DELAY_MS);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
