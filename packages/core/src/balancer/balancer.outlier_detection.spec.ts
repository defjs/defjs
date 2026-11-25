import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Balancer } from "./balancer";
import { roundRobinBalancer } from "./balancer";
import {
  outlierDetection,
  type OutlierDetectionOptions,
} from "./outlier_detection";
import { pickEndpoint } from "./runtime";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("round robin with outlierDetection returns done and ejects a rolling-restart replica until expiry", () => {
  const balancer = roundRobinBalancer({ outlierDetection: {} });
  for (let failure = 0; failure < 5; failure += 1) {
    const [, picked] = balancer.pick({
      endpoints: ["a", "b", "c"],
    });
    expect(picked?.done).toBeTypeOf("function");
    picked?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
    for (let healthy = 0; healthy < 2; healthy += 1) {
      balancer
        .pick({ endpoints: ["a", "b", "c"] })[1]
        ?.done?.({ attempted: true, status: 200 });
    }
  }
  const choices = Array.from(
    { length: 6 },
    () => balancer.pick({ endpoints: ["a", "b", "c"] })[1]?.endpoint,
  );
  expect(choices).not.toContain("a");
  expect(new Set(choices)).toEqual(new Set(["b", "c"]));
  vi.advanceTimersByTime(30000 - performance.now());
  expect(
    Array.from(
      { length: 3 },
      () => balancer.pick({ endpoints: ["a", "b", "c"] })[1]?.endpoint,
    ),
  ).toContain("a");
});

test.each(["NET_UNREACHABLE", "NET_UNAVAILABLE", "NET_SERVER_ERROR"] as const)(
  "outlier detection counts neutral %s without a status",
  (code) => {
    const balancer = roundRobinBalancer({
      outlierDetection: { consecutiveFailures: 1 },
    });
    balancer.pick({ endpoints: ["a", "b"] })[1]?.done?.({
      attempted: true,
      code,
    });
    expect(
      Array.from(
        { length: 4 },
        () => balancer.pick({ endpoints: ["a", "b"] })[1]?.endpoint,
      ),
    ).toEqual(["b", "b", "b", "b"]);
  },
);
test("outlier detection ignores a raw 503 without a neutral outcome", () => {
  const balancer = roundRobinBalancer({
    outlierDetection: { consecutiveFailures: 1 },
  });
  balancer.pick({ endpoints: ["a", "b"] })[1]?.done?.({
    attempted: true,
    status: 503,
  });
  expect(
    Array.from(
      { length: 4 },
      () => balancer.pick({ endpoints: ["a", "b"] })[1]?.endpoint,
    ),
  ).toEqual(["b", "a", "b", "a"]);
});

test("forwards start, end and done to the child result without a receiver", () => {
  const start = vi.fn();
  const end = vi.fn();
  const done = vi.fn();
  const [error, selected] = pickEndpoint(
    outlierDetection({
      pick: () => [null, { endpoint: "a", start, end, done }],
    }),
    { endpoints: ["a", "b"] },
  );
  expect(error).toBeNull();
  selected?.start();
  selected?.end({ attempted: true, status: 200 });
  selected?.done({ attempted: true, status: 200 });
  for (const callback of [start, end, done]) {
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.contexts[0]).toBeUndefined();
  }
});

test("halfOpen admits one trial request after expiry and restores traffic on success or re-ejects on failure", () => {
  const pickOrder: string[] = [];
  let desired = "a";
  const child: Balancer = {
    pick(info) {
      const endpoint = info.endpoints.includes(desired)
        ? desired
        : info.endpoints[0];
      if (endpoint === undefined) return [new Error("none"), undefined];
      pickOrder.push(endpoint);
      return [null, { endpoint }];
    },
  };
  const b = outlierDetection(child, {
    consecutiveFailures: 1,
    minPenaltyMs: 1000,
    jitterRatio: 0,
    halfOpen: true,
  });

  // Eject "a".
  pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1]?.done({
    attempted: true,
    code: "NET_UNAVAILABLE",
  });
  vi.advanceTimersByTime(1000 - performance.now());

  // If child does not pick the expired endpoint ("b" instead of "a"), "a" must not become locked probing.
  desired = "b";
  const skipped = pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1];
  expect(skipped?.endpoint).toBe("b");

  // Only one wave request probes "a"; concurrent picks route to healthy replicas.
  desired = "a";
  const probe = pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1];
  const concurrent1 = pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1];
  const concurrent2 = pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1];
  expect(probe?.endpoint).toBe("a");
  expect(concurrent1?.endpoint).toBe("b");
  expect(concurrent2?.endpoint).toBe("b");

  // Cancelled probe unlocks probing while staying half-open for the next wave.
  probe?.done({ attempted: false });
  const retryProbe = pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1];
  const blocked = pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1];
  expect(retryProbe?.endpoint).toBe("a");
  expect(blocked?.endpoint).toBe("b");

  // Probe failure immediately re-ejects at level 2 (2000ms) without waiting for consecutiveFailures.
  retryProbe?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  expect(pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1]?.endpoint).toBe(
    "b",
  );
  vi.advanceTimersByTime(1999);
  expect(pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1]?.endpoint).toBe(
    "b",
  );
  vi.advanceTimersByTime(1);

  // Probe success clears half-open gating and restores concurrent access.
  const recoveryProbe = pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1];
  expect(recoveryProbe?.endpoint).toBe("a");
  recoveryProbe?.done({ attempted: true, status: 200 });
  expect(pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1]?.endpoint).toBe(
    "a",
  );
  expect(pickEndpoint(b, { endpoints: ["a", "b", "c"] })[1]?.endpoint).toBe(
    "a",
  );
  concurrent1?.done({ attempted: true, status: 200 });
  concurrent2?.done({ attempted: true, status: 200 });
});

test("halfOpen unlocks probing on throwing isFailure, keeps panic picks non-probing, and respects eviction priority", () => {
  let shouldThrow = false;
  const b = outlierDetection(
    {
      pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }],
    },
    {
      consecutiveFailures: 1,
      minPenaltyMs: 100,
      jitterRatio: 0,
      halfOpen: true,
      isFailure(info) {
        if (shouldThrow) throw new Error("classifier boom");
        return info.code !== undefined;
      },
    },
  );
  pickEndpoint(b, { endpoints: ["a", "b"] })[1]?.done({
    attempted: true,
    code: "NET_UNAVAILABLE",
  });
  vi.advanceTimersByTime(100);
  const firstProbe = b.pick({ endpoints: ["a", "b"] })[1];
  shouldThrow = true;
  expect(() =>
    firstProbe?.done?.({ attempted: true, code: "NET_UNAVAILABLE" }),
  ).toThrow("classifier boom");
  shouldThrow = false;

  // Next pick can probe again because probing was cleared before isFailure threw.
  const secondProbe = pickEndpoint(b, { endpoints: ["a", "b"] })[1];
  expect(secondProbe?.endpoint).toBe("a");

  // Panic-mode pick while "a" is probing does not unlock "a"s active probe lock.
  const panicPick = pickEndpoint(b, { endpoints: ["a"] })[1];
  expect(panicPick?.endpoint).toBe("a");
  panicPick?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  // Probe finishes after panic-mode already ejected "a" (ejections !== counted).
  secondProbe?.done({ attempted: true, status: 200 });

  // Eviction priority checks awaitingProbe state when LRU exceeds 256 entries.
  const largeBalancer = roundRobinBalancer({
    outlierDetection: {
      consecutiveFailures: 1,
      minPenaltyMs: 100,
      jitterRatio: 0,
      halfOpen: true,
    },
  });
  const pool = Array.from({ length: 260 }, (_, i) => `h-${i}`);
  // Eject h-0 and expire it without probing so awaitingProbe stays true on h-0.
  pickEndpoint(largeBalancer, { endpoints: ["h-0", "h-1"] })[1]?.done({
    attempted: true,
    code: "NET_UNAVAILABLE",
  });
  vi.advanceTimersByTime(100);
  for (const host of pool.slice(1)) {
    pickEndpoint(largeBalancer, { endpoints: [host] })[1]?.done({
      attempted: true,
      status: 200,
    });
  }
  expect(
    pickEndpoint(largeBalancer, { endpoints: ["h-0", "h-1"] })[1]?.endpoint,
  ).toBe("h-0");
});

test("maxEjectionPercent limits simultaneous ejections across sampling, shrinking pools, and halfOpen probes", () => {
  const setup = (options: OutlierDetectionOptions) => {
    let desired = "a";
    const b = outlierDetection(
      {
        pick(info) {
          const endpoint = info.endpoints.includes(desired)
            ? desired
            : (info.endpoints[0] ?? "");
          return [null, { endpoint }];
        },
      },
      {
        consecutiveFailures: 1,
        minPenaltyMs: 1000,
        jitterRatio: 0,
        ...options,
      },
    );
    return {
      b,
      pick(endpoints: readonly string[]) {
        return pickEndpoint(b, { endpoints })[1];
      },
      setDesired(ep: string) {
        desired = ep;
      },
    };
  };

  // 50% of 4 endpoints => max 2 ejected at a time; "d" stays untouched (other === undefined).
  const capped = setup({ maxEjectionPercent: 50 });
  const pool4 = ["a", "b", "c", "d"];
  capped.setDesired("a");
  capped.pick(pool4)?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  vi.advanceTimersByTime(100);
  capped.setDesired("b");
  capped.pick(pool4)?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  capped.setDesired("c");
  capped.pick(pool4)?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  // "c" was blocked by quota, so it remains selectable (no phantom ejection).
  expect(capped.pick(pool4)?.endpoint).toBe("c");
  // When pool shrinks from 4 to 2 ("a" until=1000, "b" until=1100), cap becomes 1: latest "b" stays excluded, "a" is allowed.
  capped.setDesired("a");
  expect(capped.pick(["a", "b"])?.endpoint).toBe("a");
  // Once "a" expires, "c" can immediately eject on its next failure.
  vi.advanceTimersByTime(900);
  capped.setDesired("c");
  capped.pick(pool4)?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  expect(capped.pick(pool4)?.endpoint).toBe("a");

  // 0% ejects nothing at all.
  const zeroCap = setup({ maxEjectionPercent: 0 });
  zeroCap.pick(["a", "b"])?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  expect(zeroCap.pick(["a", "b"])?.endpoint).toBe("a");

  // halfOpen probe failure when quota is already filled clears awaitingProbe cleanly.
  const halfOpenCapped = setup({ maxEjectionPercent: 50, halfOpen: true });
  halfOpenCapped.setDesired("a");
  halfOpenCapped
    .pick(["a", "b"])
    ?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  vi.advanceTimersByTime(1000);
  const probeA = halfOpenCapped.pick(["a", "b"]);
  expect(probeA?.endpoint).toBe("a");
  halfOpenCapped.setDesired("b");
  halfOpenCapped
    .pick(["a", "b"])
    ?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  probeA?.done({ attempted: true, code: "NET_UNAVAILABLE" });
  // Quota full ("b" ejected), so "a" clears awaitingProbe and remains available.
  halfOpenCapped.setDesired("a");
  expect(halfOpenCapped.pick(["a", "b"])?.endpoint).toBe("a");
});
