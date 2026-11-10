import type { RetryContext, RetryOptions } from "../client/config";
import { awaitWithSignal } from "./abort";

const DEFAULT_METHODS: readonly string[] = [
  "GET",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "PUT",
  "DELETE",
];

/** `RetryOptions` with every default applied. HTTP, SSE and WebSocket read the same record. */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly factor: number;
  readonly maxDelayMs: number;
  readonly jitter: number;
  readonly attemptTimeoutMs: number | undefined;
  /** Upper-cased, so a method is compared with `includes(method.toUpperCase())`. */
  readonly methods: readonly string[];
  readonly shouldRetry: RetryOptions["shouldRetry"];
}

/** No options means no retries: `undefined` stays `undefined` and a call makes one attempt. */
export function resolveRetryPolicy(
  options: RetryOptions | undefined,
): RetryPolicy | undefined {
  if (options === undefined) {
    return undefined;
  }
  return {
    maxRetries: options.maxRetries ?? 3,
    delayMs: options.delayMs ?? 1000,
    factor: options.factor ?? 2,
    maxDelayMs: options.maxDelayMs ?? 30_000,
    jitter: options.jitter ?? 0.2,
    attemptTimeoutMs: options.attemptTimeoutMs,
    methods: (options.methods ?? DEFAULT_METHODS).map((method) =>
      method.toUpperCase(),
    ),
    shouldRetry: options.shouldRetry,
  };
}

export function isRetryMethod(policy: RetryPolicy, method: string): boolean {
  return policy.methods.includes(method.toUpperCase());
}

/** Whether `retried` retries since the last established connection still leave room for one more. */
function hasRetriesLeft(policy: RetryPolicy, retried: number): boolean {
  return retried < policy.maxRetries;
}

/**
 * The shared part of the flow after a failed attempt: the transport has already ended calls that never retry
 * (a caller stop, a fatal error, a spent request body). Here the retry budget of `maxRetries` is checked first,
 * then `shouldRetry` decides, or the default verdict in `retryable` when there is none.
 *
 * `describe` receives the number of the retry about to start and builds the context lazily, so a call that
 * has no retries left pays for nothing. It rejects with the signal's reason when `signal` aborts while a
 * `shouldRetry` promise is pending, and with whatever `shouldRetry` throws.
 */
export async function decideRetry(
  policy: RetryPolicy,
  retried: number,
  signal: AbortSignal,
  describe: (attempt: number) => RetryContext,
): Promise<boolean> {
  if (!hasRetriesLeft(policy, retried)) {
    return false;
  }
  const context = describe(retried + 1);
  const shouldRetry = policy.shouldRetry;
  if (shouldRetry === undefined) {
    return context.retryable;
  }
  return awaitWithSignal(() => shouldRetry(context), signal);
}
