import type { RetryContext, RetryOptions } from "../client/config";
import type { PreflightFault } from "../error";
import { createPreflightFault } from "../error";
import { awaitWithSignal, resolveAbortedFault } from "./abort";

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

/**
 * The decision after a failed attempt, as a value a transport can switch on: `"retry"`, `"stop"`, or the fault that
 * ends the call because `shouldRetry` failed. The transport has already ended calls that never retry (a caller
 * stop, a fatal error, a spent request body).
 *
 * The retry budget of `maxRetries` is checked first, then `shouldRetry` decides, or the default verdict in
 * `retryable` when there is none. `describe` receives the number of the retry about to start and builds the context
 * lazily, so a call that has no retries left pays for nothing.
 *
 * A `describe` or `shouldRetry` that throws or rejects is `EXT_HOOK_FAILED` with the thrown value as `cause`, unless
 * `signal` has aborted meanwhile, which also ends a pending `shouldRetry`: then the fault is `NET_ABORTED` or
 * `NET_TIMEOUT`. It never rejects.
 * The wait before the retry is not part of it. The transport does what the retry needs first (spend budget, end the
 * attempt, take a server-supplied delay), then waits for `computeReconnectDelay` with `wait`.
 */
export async function retryStep(
  policy: RetryPolicy,
  retried: number,
  signal: AbortSignal,
  describe: (attempt: number) => RetryContext,
): Promise<"retry" | "stop" | PreflightFault> {
  try {
    if (retried >= policy.maxRetries) {
      return "stop";
    }
    const context = describe(retried + 1);
    const shouldRetry = policy.shouldRetry;
    const retry =
      shouldRetry === undefined
        ? context.retryable
        : await awaitWithSignal(() => shouldRetry(context), signal);
    return retry ? "retry" : "stop";
  } catch (error) {
    return signal.aborted
      ? resolveAbortedFault(signal)
      : createPreflightFault("EXT_HOOK_FAILED", error);
  }
}
