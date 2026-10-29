import { describe, expect, test, vi } from "vitest";
import { computeReconnectDelay, wait } from "../internal/backoff";
import {
  normalizeReconnectConfig,
  shouldReconnect,
  type NormalizedReconnectConfig,
} from "./reconnect";
import type { SocketLifecycleOutcome } from "./web_socket";

describe("reconnect config", () => {
  test("normalizeReconnectConfig returns undefined for undefined input", () => {
    expect(normalizeReconnectConfig(undefined)).toBeUndefined();
  });

  test("normalizeReconnectConfig keeps a validated zero retry budget", () => {
    expect(normalizeReconnectConfig({ attempts: 0 })).toMatchObject({
      attempts: 0,
    });
  });

  test.each([
    ["attempts", { attempts: -1 }],
    ["attempts", { attempts: 1.5 }],
    ["attempts", { attempts: Number.POSITIVE_INFINITY }],
    ["delayMs", { delayMs: -1 }],
    ["delayMs", { delayMs: Number.NaN }],
    ["factor", { factor: 0 }],
    ["factor", { factor: Number.POSITIVE_INFINITY }],
    ["jitter", { jitter: -0.1 }],
    ["jitter", { jitter: 1.1 }],
    ["jitter", { jitter: Number.NaN }],
    ["maxDelayMs", { maxDelayMs: -1 }],
    ["maxDelayMs", { maxDelayMs: Number.NEGATIVE_INFINITY }],
    ["maxDelayMs", { maxDelayMs: Number.NaN }],
    ["delayMs", { attempts: 0, delayMs: -1 }],
    ["factor", { attempts: 0, factor: 0 }],
    ["jitter", { attempts: 0, jitter: Number.NaN }],
    ["maxDelayMs", { attempts: 0, maxDelayMs: -1 }],
  ])(
    "rejects invalid %s instead of creating a timer or retry loop",
    (field, config) => {
      expect(() => normalizeReconnectConfig(config)).toThrow(
        `WebSocket reconnect ${field}`,
      );
    },
  );

  test("normalizeReconnectConfig uses defaults", () => {
    const config = normalizeReconnectConfig({});
    expect(config).toMatchObject({
      attempts: 3,
      delayMs: 1000,
      factor: 2,
      jitter: 0,
      maxDelayMs: 30000,
    });
    expect(config?.shouldReconnect({} as SocketLifecycleOutcome, 1)).toBe(true);
  });

  test("normalizeReconnectConfig accepts custom values", () => {
    const config = normalizeReconnectConfig({
      attempts: 5,
      delayMs: 500,
      factor: 3,
      jitter: 0.5,
      maxDelayMs: 10000,
    });
    expect(config).toMatchObject({
      attempts: 5,
      delayMs: 500,
      factor: 3,
      jitter: 0.5,
      maxDelayMs: 10000,
    });
  });

  test("normalizeReconnectConfig accepts an unbounded positive infinite cap", () => {
    const config = normalizeReconnectConfig({
      delayMs: 1000,
      factor: 2,
      maxDelayMs: Number.POSITIVE_INFINITY,
    });
    expect(config?.maxDelayMs).toBe(Number.POSITIVE_INFINITY);
    if (!config) throw new Error("Expected reconnect config");
    expect(computeReconnectDelay(config, 10)).toBe(512_000);
  });

  test("normalizeReconnectConfig custom shouldReconnect receives correct context", () => {
    const customFn = vi.fn().mockReturnValue(false);
    const config = normalizeReconnectConfig({ shouldReconnect: customFn });
    const outcome: SocketLifecycleOutcome = {
      closeInfo: { code: 1006, reason: "abnormal", wasClean: false },
      cause: new Error("test"),
      opened: true,
    };
    const result = config?.shouldReconnect(outcome, 2);
    expect(result).toBe(false);
    expect(customFn).toHaveBeenCalledWith({
      attempt: 2,
      cause: outcome.cause,
      code: 1006,
      reason: "abnormal",
      wasClean: false,
    });
  });

  test("normalizeReconnectConfig snapshots shouldReconnect exactly once", () => {
    const firstPredicate = vi.fn().mockReturnValue(false);
    const secondPredicate = vi.fn().mockReturnValue(true);
    let reads = 0;
    const config = normalizeReconnectConfig({
      get shouldReconnect() {
        reads += 1;
        return reads === 1 ? firstPredicate : secondPredicate;
      },
    });

    expect(
      config?.shouldReconnect(
        { closeInfo: {}, opened: true } as SocketLifecycleOutcome,
        1,
      ),
    ).toBe(false);
    expect(config?.hasShouldReconnect).toBe(true);
    expect(reads).toBe(1);
    expect(firstPredicate).toHaveBeenCalledTimes(1);
    expect(secondPredicate).not.toHaveBeenCalled();
  });
});

describe("shouldReconnect", () => {
  test("returns false when config is undefined", () => {
    expect(shouldReconnect(undefined, {} as SocketLifecycleOutcome, 1)).toBe(
      false,
    );
  });

  test("returns false when not opened and attempts <= 0", () => {
    const config = normalizeReconnectConfig({ attempts: 0 });
    expect(
      shouldReconnect(config, { opened: false } as SocketLifecycleOutcome, 1),
    ).toBe(false);
  });

  test("returns true with default config", () => {
    const config = normalizeReconnectConfig({});
    expect(
      shouldReconnect(config, { opened: true } as SocketLifecycleOutcome, 1),
    ).toBe(true);
  });

  test("returns false when opened is false and attempts is zero on normalized config", () => {
    const config: NormalizedReconnectConfig = {
      attempts: 0,
      delayMs: 1000,
      factor: 2,
      hasShouldReconnect: false,
      jitter: 0,
      maxDelayMs: 30000,
      shouldReconnect: () => true,
    };
    expect(
      shouldReconnect(config, { opened: false } as SocketLifecycleOutcome, 1),
    ).toBe(false);
  });
});

describe("computeReconnectDelay", () => {
  test("computes exponential delay without jitter", () => {
    const config = normalizeReconnectConfig({ delayMs: 1000, factor: 2 });
    expect(config).toBeDefined();
    if (!config) {
      throw new Error("Expected reconnect config");
    }
    expect(computeReconnectDelay(config, 1)).toBe(1000);
    expect(computeReconnectDelay(config, 2)).toBe(2000);
    expect(computeReconnectDelay(config, 3)).toBe(4000);
  });

  test("caps delay at maxDelayMs", () => {
    const config = normalizeReconnectConfig({
      delayMs: 1000,
      factor: 2,
      maxDelayMs: 3000,
    });
    expect(config).toBeDefined();
    if (!config) {
      throw new Error("Expected reconnect config");
    }
    expect(computeReconnectDelay(config, 3)).toBe(3000);
    expect(computeReconnectDelay(config, 10)).toBe(3000);
  });

  test("clamps a finite delay to the platform timer maximum", () => {
    const config = normalizeReconnectConfig({
      delayMs: 3_000_000_000,
      factor: 1,
      maxDelayMs: 4_000_000_000,
    });
    expect(config).toBeDefined();
    if (!config) {
      throw new Error("Expected reconnect config");
    }
    expect(computeReconnectDelay(config, 1)).toBe(2_147_483_647);
  });

  test("saturates a computed overflow instead of passing it to setTimeout", () => {
    const config: NormalizedReconnectConfig = {
      attempts: 1,
      delayMs: Number.MAX_VALUE,
      factor: Number.MAX_VALUE,
      hasShouldReconnect: false,
      jitter: 1,
      maxDelayMs: Number.MAX_VALUE,
      shouldReconnect: () => true,
    };
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(computeReconnectDelay(config, 2)).toBe(2_147_483_647);
    vi.restoreAllMocks();
  });

  test("applies jitter within range", () => {
    const config = normalizeReconnectConfig({
      delayMs: 1000,
      factor: 2,
      jitter: 0.5,
    });
    expect(config).toBeDefined();
    if (!config) {
      throw new Error("Expected reconnect config");
    }
    for (let i = 0; i < 20; i++) {
      const delay = computeReconnectDelay(config, 1);
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(1500);
    }
  });

  test("returns 0 for attempt 0", () => {
    const config = normalizeReconnectConfig({ delayMs: 1000 });
    expect(config).toBeDefined();
    if (!config) {
      throw new Error("Expected reconnect config");
    }
    expect(computeReconnectDelay(config, 0)).toBe(1000);
  });
});

describe("wait", () => {
  test("resolves after delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let settled = false;
    const pending = wait(50, new AbortController().signal).then(() => {
      settled = true;
    });

    try {
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(49);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("resolves immediately when ms <= 0", async () => {
    await expect(
      wait(0, new AbortController().signal),
    ).resolves.toBeUndefined();
    await expect(
      wait(-1, new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  test("rejects non-finite waits before Node can emit a timer overflow warning", async () => {
    await expect(
      wait(Number.POSITIVE_INFINITY, new AbortController().signal),
    ).rejects.toThrow("Reconnect delay must be finite");
  });

  test("rejects when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("already aborted");
    await expect(wait(1000, controller.signal)).rejects.toBe("already aborted");
  });

  test("rejects when signal aborts during wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const controller = new AbortController();
    const pending = wait(1000, controller.signal);

    try {
      expect(vi.getTimerCount()).toBe(1);
      controller.abort("aborted");
      await expect(pending).rejects.toBe("aborted");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
