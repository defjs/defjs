import { afterEach, describe, expect, test, vi } from "vitest";
import { computeReconnectDelay } from "./backoff";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computeReconnectDelay", () => {
  test("caps the final delay after positive jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(
      computeReconnectDelay(
        { delayMs: 1000, factor: 2, jitter: 1, maxDelayMs: 3000 },
        10,
      ),
    ).toBe(3000);
  });

  test("keeps fractional caps after jitter rounding", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    expect(
      computeReconnectDelay(
        { delayMs: 0.5, factor: 1, jitter: 1, maxDelayMs: 0.5 },
        1,
      ),
    ).toBe(0.5);
  });

  test.each([
    { factor: 2, attempt: 1025, maxDelayMs: 50 },
    { factor: Number.MAX_VALUE, attempt: 3, maxDelayMs: 50 },
    { factor: 2, attempt: 1025, maxDelayMs: Number.POSITIVE_INFINITY },
  ])(
    "keeps a zero base at zero when the exponent overflows: %j",
    ({ factor, attempt, maxDelayMs }) => {
      expect(
        computeReconnectDelay(
          { delayMs: 0, factor, jitter: 0, maxDelayMs },
          attempt,
        ),
      ).toBe(0);
    },
  );

  test("saturates exponent overflow with the SSE default unbounded cap", () => {
    expect(
      computeReconnectDelay(
        {
          delayMs: 1,
          factor: 2,
          jitter: 0,
          maxDelayMs: Number.POSITIVE_INFINITY,
        },
        1025,
      ),
    ).toBe(2_147_483_647);
  });

  test("keeps zero jitter multipliers finite after exponent overflow", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(
      computeReconnectDelay(
        {
          delayMs: 1,
          factor: 2,
          jitter: 1,
          maxDelayMs: Number.POSITIVE_INFINITY,
        },
        1025,
      ),
    ).toBe(0);
  });

  test("saturates jitter multiplication overflow", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(
      computeReconnectDelay(
        {
          delayMs: Number.MAX_VALUE,
          factor: Number.MAX_VALUE,
          jitter: 1,
          maxDelayMs: Number.MAX_VALUE,
        },
        2,
      ),
    ).toBe(2_147_483_647);
  });

  test("preserves downward jitter on finite delays above the timer limit", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(
      computeReconnectDelay(
        {
          delayMs: 3_000_000_000,
          factor: 1,
          jitter: 0.5,
          maxDelayMs: Number.POSITIVE_INFINITY,
        },
        1,
      ),
    ).toBe(1_500_000_000);
  });

  test("rejects a non-finite delay supplied after reconnect normalization", () => {
    expect(() =>
      computeReconnectDelay(
        { delayMs: Number.NaN, factor: 2, jitter: 0, maxDelayMs: 50 },
        1,
      ),
    ).toThrow("Reconnect delay must be finite");
  });
});
