import { afterEach, describe, expect, test, vi } from "vitest";
import { computeReconnectDelay, wait } from "./backoff";

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
});

describe("wait", () => {
  test("resolves at once for a zero delay without listening to the signal", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    await wait(0, controller.signal);
    expect(add).not.toHaveBeenCalled();
  });

  test("rejects with the reason of a signal that is already aborted, and sets no timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const controller = new AbortController();
      const reason = new Error("stop");
      controller.abort(reason);
      await expect(wait(1000, controller.signal)).rejects.toBe(reason);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects with the signal reason when it aborts during the delay and clears its timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const controller = new AbortController();
      const pending = wait(1000, controller.signal);
      const caught = pending.catch((reason: unknown) => reason);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort("because");
      expect(await caught).toBe("because");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("resolves after the delay and leaves no listener on the signal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const pending = wait(1000, controller.signal);
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });
});
