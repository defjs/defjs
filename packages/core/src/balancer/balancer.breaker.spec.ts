import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DoneInfo } from "./balancer";
import { pickFirstBalancer, roundRobinBalancer } from "./balancer";
import { outlierDetection } from "./outlier_detection";
import { p2cBalancer } from "./p2c";
import { pickEndpoint } from "./runtime";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const list = ["a", "b", "c"];
const bad: DoneInfo = { attempted: true, code: "NET_UNAVAILABLE" };
const ok: DoneInfo = { attempted: true, status: 200 };
function setup(options = {}) {
  let desired = "a";
  let candidates: readonly string[] = [];
  const childEnd = vi.fn();
  const childDone = vi.fn();
  const childStart = vi.fn();
  const b = outlierDetection(
    {
      pick(info) {
        candidates = info.endpoints;
        return [
          null,
          {
            endpoint: info.endpoints.includes(desired)
              ? desired
              : (info.endpoints[0] ?? ""),
            start: childStart,
            end: childEnd,
            done: childDone,
          },
        ];
      },
    },
    { consecutiveFailures: 1, ...options },
  );
  function pick(endpoints = list) {
    const [e, p] = pickEndpoint(b, { endpoints });
    expect(e).toBeNull();
    if (!p) throw new Error("missing pick");
    return p;
  }
  return {
    b,
    pick,
    candidates: () => candidates,
    desire: (s: string) => {
      desired = s;
    },
    childEnd,
    childDone,
    childStart,
  };
}
test("penalties grow linearly with positive jitter and cap at sixty seconds", () => {
  vi.mocked(Math.random).mockReturnValue(0.5);
  const h = setup();
  h.pick().done(bad);
  let now = 0;
  // Level n lasts n times the 1000ms minimum plus 25% jitter, capped at 60000ms.
  for (let level = 1; level <= 52; level++) {
    const delay = Math.min(1250 * level, 60000);
    vi.advanceTimersByTime(now + delay - 1 - performance.now());
    expect(h.pick().endpoint).toBe("b");
    now += delay;
    vi.advanceTimersByTime(now - performance.now());
    const again = h.pick();
    expect(again.endpoint).toBe("a");
    again.done(bad);
  }
});
test("all three hosts may break; fail-open uses the exact current original list", () => {
  const h = setup();
  for (const endpoint of list) {
    h.desire(endpoint);
    h.pick().done(bad);
  }
  h.pick();
  expect(h.candidates()).toBe(list);
  h.pick(["b"]);
  expect(h.candidates()).toEqual(["b"]);
});
test("a lone broken host is excluded when a healthy candidate is later discovered", () => {
  const h = setup();
  h.pick(["a"]).done(bad);
  expect(h.pick(["a", "b"]).endpoint).toBe("b");
});
test("expiry puts the endpoint back for every pick without a trial request", () => {
  const b = roundRobinBalancer({ outlierDetection: {} });
  for (let i = 0; i < 15; i++) {
    const [, p] = b.pick({ endpoints: list });
    p?.done?.(p.endpoint === "a" ? bad : ok);
  }
  vi.advanceTimersByTime(1000 - performance.now());
  const wave = Array.from(
    { length: 60 },
    () => pickEndpoint(b, { endpoints: list })[1],
  );
  expect(wave.filter((p) => p?.endpoint === "a")).toHaveLength(20);
});
test("a failure right after expiry ejects again with the next level", () => {
  const h = setup();
  h.pick().done(bad);
  vi.advanceTimersByTime(1000 - performance.now());
  h.pick().done(bad);
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(2999 - performance.now());
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(3000 - performance.now());
  expect(h.pick().endpoint).toBe("a");
});
test("end is forwarded and never counted; only done carries a sample", () => {
  const h = setup();
  const attempt = h.pick();
  attempt.start();
  attempt.end(bad);
  expect(h.childEnd).toHaveBeenCalledWith(bad);
  expect(h.pick().endpoint).toBe("a");
  attempt.done(bad);
  expect(h.pick().endpoint).toBe("b");
});
test("an endpoint that accepts and then drops escalates its penalty", () => {
  const h = setup({ consecutiveFailures: 5 });
  for (let i = 0; i < 5; i++) h.pick().done(bad);
  let now = 0;
  for (const delay of [1000, 2000, 3000, 4000]) {
    now += delay;
    vi.advanceTimersByTime(now - 1 - performance.now());
    expect(h.pick().endpoint).toBe("b");
    vi.advanceTimersByTime(now - performance.now());
    for (let i = 0; i < 5; i++) {
      const attempt = h.pick();
      expect(attempt.endpoint).toBe("a");
      attempt.start();
      attempt.end(ok);
      attempt.done(bad);
    }
  }
});
// Three ejections (1s, 2s and 3s) leave level three, and the third ends at 6s.
function expireAtLevelThree(h: ReturnType<typeof setup>): void {
  h.pick().done(bad);
  for (const wait of [1000, 2000]) {
    vi.advanceTimersByTime(wait);
    h.pick().done(bad);
  }
  vi.advanceTimersByTime(3000);
}
test.each([
  { healthyMs: 0, penaltyMs: 4000 },
  { healthyMs: 9999, penaltyMs: 4000 },
  { healthyMs: 10000, penaltyMs: 3000 },
  { healthyMs: 29999, penaltyMs: 2000 },
  { healthyMs: 30000, penaltyMs: 1000 },
  { healthyMs: 3600000, penaltyMs: 1000 },
])(
  "an expired ejection keeps the level, which decays one step per ten seconds without one ($healthyMs ms)",
  ({ healthyMs, penaltyMs }) => {
    const h = setup();
    expireAtLevelThree(h);
    vi.advanceTimersByTime(healthyMs);
    h.pick().done(bad);
    vi.advanceTimersByTime(penaltyMs - 1);
    expect(h.pick().endpoint).toBe("b");
    vi.advanceTimersByTime(1);
    expect(h.pick().endpoint).toBe("a");
  },
);
test("time that has not yet earned a step is kept across picks", () => {
  const h = setup();
  expireAtLevelThree(h);
  vi.advanceTimersByTime(15000);
  expect(h.pick().endpoint).toBe("a");
  vi.advanceTimersByTime(15000);
  h.pick().done(bad);
  vi.advanceTimersByTime(999);
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(1);
  expect(h.pick().endpoint).toBe("a");
});
test("the level does not decay while the endpoint is ejected", () => {
  const h = setup({ minPenaltyMs: 20000, maxPenaltyMs: 100000 });
  h.pick().done(bad);
  vi.advanceTimersByTime(19999);
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(1);
  h.pick().done(bad);
  vi.advanceTimersByTime(39999);
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(1);
  expect(h.pick().endpoint).toBe("a");
});
test("a session closed by the caller does not carry its level into a later independent outage", () => {
  const h = setup();
  h.pick().done(bad);
  vi.advanceTimersByTime(1000);
  const session = h.pick();
  session.start();
  vi.advanceTimersByTime(5000);
  session.done({ attempted: false });
  vi.advanceTimersByTime(3600000);
  h.pick().done(bad);
  vi.advanceTimersByTime(999);
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(1);
  expect(h.pick().endpoint).toBe("a");
});
test("a session that ends after the level has decayed is counted at the decayed level", () => {
  const h = setup();
  expireAtLevelThree(h);
  const session = h.pick();
  vi.advanceTimersByTime(30000);
  session.done(bad);
  vi.advanceTimersByTime(999);
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(1);
  expect(h.pick().endpoint).toBe("a");
});
test("a backward wall-clock step without Performance does not inflate the level", () => {
  vi.stubGlobal("performance", undefined);
  vi.setSystemTime(3600000);
  const h = setup();
  h.pick().done(bad);
  vi.advanceTimersByTime(1000);
  const session = h.pick();
  vi.setSystemTime(0);
  session.done(bad);
  vi.advanceTimersByTime(1999);
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(1);
  expect(h.pick().endpoint).toBe("a");
});
test("health forwards start and end unchanged", () => {
  const h = setup();
  const p = h.pick();
  p.start();
  p.end(ok);
  expect(h.childStart).toHaveBeenCalledOnce();
  expect(h.childEnd).toHaveBeenCalledWith(ok);
  expect(h.pick().endpoint).toBe("a");
});
test.each([
  { minPenaltyMs: 0 },
  { minPenaltyMs: -1 },
  { minPenaltyMs: NaN },
  { minPenaltyMs: Infinity },
  { minPenaltyMs: "1" },
  { maxPenaltyMs: 0 },
  { maxPenaltyMs: NaN },
  { maxPenaltyMs: Infinity },
  { maxPenaltyMs: "1" },
  { minPenaltyMs: 20, maxPenaltyMs: 10 },
  { jitterRatio: -0.1 },
  { jitterRatio: 1.1 },
  { jitterRatio: NaN },
  { jitterRatio: Infinity },
  { jitterRatio: "0" },
  ...[
    "maxEjectionPercent",
    "baseEjectionMs",
    "maxEjectionMs",
    "intervalMs",
    "failurePercentage",
    "halfOpen",
    "probeTimeoutMs",
    "slowStartWindowMs",
    "slowStartMinWeightPercent",
  ].map((key) => ({ [key]: 1 })),
])(
  "invalid or removed health option %j is rejected by every factory",
  (options) => {
    for (const b of [
      // @ts-expect-error invalid health options are rejected at runtime
      outlierDetection(pickFirstBalancer(), options),
      // @ts-expect-error invalid health options are rejected at runtime
      pickFirstBalancer({ outlierDetection: options }),
      // @ts-expect-error invalid health options are rejected at runtime
      roundRobinBalancer({ outlierDetection: options }),
      // @ts-expect-error invalid health options are rejected at runtime
      p2cBalancer({ outlierDetection: options }),
    ])
      expect(pickEndpoint(b, { endpoints: list })[0]?.code).toBe(
        "REQ_OPTIONS_INVALID",
      );
  },
);

test("an attempted outcome without a code resets a streak", () => {
  const plain = setup({ consecutiveFailures: 2 });
  plain.pick().done(bad);
  plain.pick().done({ attempted: true });
  plain.pick().done(bad);
  expect(plain.pick().endpoint).toBe("a");
});
