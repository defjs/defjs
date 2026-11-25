import { MAX_TIMER_DELAY_MS } from "./backoff";

/**
 * Parses an RFC 9110 `Retry-After` header value into milliseconds.
 *
 * Accepts non-negative integer `delay-seconds` and RFC 9110 `HTTP-date` values.
 * Absent headers (`null`), empty strings, negative or fractional numbers, and
 * unparseable strings return `undefined` so callers can fall back to backoff.
 * Past dates clamp to `0`.
 */
export function parseRetryAfter(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) ? ms : Infinity;
  }
  // Every RFC 9110 HTTP-date includes weekday and month names; reject numeric forms like `-1` or `1.5`.
  if (!/[A-Za-z]/.test(trimmed)) {
    return undefined;
  }
  const target = Date.parse(trimmed);
  if (Number.isNaN(target)) {
    return undefined;
  }
  return Math.max(0, target - nowMs);
}

/**
 * Computes the wait delay for a server-supplied `Retry-After` duration.
 *
 * Applies positive-only jitter so retries never fire earlier than the server
 * requested, then bounds the result by `maxRetryAfterMs` and the platform timer cap.
 */
export function computeRetryAfterDelay(
  retryAfterMs: number,
  jitter: number,
  maxRetryAfterMs: number,
): number {
  if (retryAfterMs <= 0) {
    return 0;
  }
  const raw =
    jitter <= 0
      ? retryAfterMs
      : Math.round(retryAfterMs * (1 + Math.random() * jitter));
  return Math.min(raw, maxRetryAfterMs, MAX_TIMER_DELAY_MS);
}
