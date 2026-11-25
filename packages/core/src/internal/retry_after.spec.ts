import { afterEach, describe, expect, test, vi } from "vitest";
import { MAX_TIMER_DELAY_MS } from "./backoff";
import { computeRetryAfterDelay, parseRetryAfter } from "./retry_after";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseRetryAfter", () => {
  test("returns undefined for null and blank values", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("   \t  ")).toBeUndefined();
  });

  test("parses non-negative delay-seconds and handles overflow", () => {
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(" 5 ")).toBe(5000);
    expect(parseRetryAfter("9".repeat(400))).toBe(Infinity);
  });

  test("rejects negative, fractional, and malformed values", () => {
    expect(parseRetryAfter("-1")).toBeUndefined();
    expect(parseRetryAfter("1.5")).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter("12s")).toBeUndefined();
  });

  test("parses RFC 9110 HTTP-date values relative to nowMs", () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    expect(parseRetryAfter("Tue, 24 Nov 2026 12:00:10 GMT", now)).toBe(10_000);
    expect(parseRetryAfter("Tue, 24 Nov 2026 11:59:50 GMT", now)).toBe(0);
  });
});

describe("computeRetryAfterDelay", () => {
  test("returns zero immediately when retryAfterMs is zero or negative", () => {
    expect(computeRetryAfterDelay(0, 0.2, 60_000)).toBe(0);
    expect(computeRetryAfterDelay(-10, 0.2, 60_000)).toBe(0);
  });

  test("applies positive-only jitter and caps at maxRetryAfterMs and timer limit", () => {
    const rand = vi.spyOn(Math, "random");
    rand.mockReturnValue(0);
    expect(computeRetryAfterDelay(1000, 0.2, 60_000)).toBe(1000);

    rand.mockReturnValue(1);
    expect(computeRetryAfterDelay(1000, 0.2, 60_000)).toBe(1200);
    expect(computeRetryAfterDelay(1000, 0, 60_000)).toBe(1000);
    expect(computeRetryAfterDelay(59_000, 0.2, 60_000)).toBe(60_000);
    expect(computeRetryAfterDelay(MAX_TIMER_DELAY_MS + 1000, 0, Infinity)).toBe(
      MAX_TIMER_DELAY_MS,
    );
  });
});
