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
test("Linkerd penalties double with positive jitter, cap at sixty seconds and reset after a successful end", () => {
  vi.mocked(Math.random).mockReturnValue(0.5);
  const h = setup();
  h.pick().done(bad);
  let now = 0;
  for (const delay of [1250, 2500, 5000, 10000, 20000, 40000, 60000, 60000]) {
    vi.advanceTimersByTime(now + delay - 1 - performance.now());
    expect(h.pick().endpoint).toBe("b");
    now += delay;
    vi.advanceTimersByTime(now - performance.now());
    const probe = h.pick();
    expect(probe.endpoint).toBe("a");
    probe.start();
    probe.end(bad);
    probe.done(bad);
  }
  now += 60000;
  vi.advanceTimersByTime(now - performance.now());
  const success = h.pick();
  success.start();
  success.end(ok);
  expect(h.pick().endpoint).toBe("a");
  h.pick().done(bad);
  vi.advanceTimersByTime(now + 1249 - performance.now());
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(now + 1250 - performance.now());
  expect(h.pick().endpoint).toBe("a");
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
test("expiry admits only one of sixty picks and end restores traffic before done", () => {
  const b = roundRobinBalancer();
  for (let i = 0; i < 15; i++) {
    const [, p] = b.pick({ endpoints: list });
    p?.done?.(p.endpoint === "a" ? bad : ok);
  }
  vi.advanceTimersByTime(1000 - performance.now());
  const wave = Array.from(
    { length: 60 },
    () => pickEndpoint(b, { endpoints: list })[1],
  );
  const probes = wave.filter((p) => p?.endpoint === "a");
  expect(probes).toHaveLength(1);
  probes[0]?.start();
  probes[0]?.end(ok);
  expect(
    Array.from(
      { length: 60 },
      () => b.pick({ endpoints: list })[1]?.endpoint,
    ).filter((e) => e === "a"),
  ).toHaveLength(20);
});
test("probe end failure immediately reopens the breaker without waiting for done", () => {
  const h = setup();
  h.pick().done(bad);
  vi.advanceTimersByTime(1000 - performance.now());
  const probe = h.pick();
  probe.start();
  probe.end(bad);
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(2999 - performance.now());
  expect(h.pick().endpoint).toBe("b");
  vi.advanceTimersByTime(3000 - performance.now());
  expect(h.pick().endpoint).toBe("a");
});
test.each(["sse", "websocket"] as const)(
  "%s probe is decided by handshake end rather than session lifetime",
  () => {
    const h = setup();
    h.pick().done(bad);
    vi.advanceTimersByTime(1000 - performance.now());
    const [, probe] = pickEndpoint(h.b, { endpoints: list });
    probe?.start();
    vi.advanceTimersByTime(100000 - performance.now());
    expect(h.pick().endpoint).toBe("b");
    probe?.end(ok);
    expect(h.pick().endpoint).toBe("a");
  },
);
test("done after a successful probe end is an ordinary failure sample", () => {
  const h = setup();
  h.pick().done(bad);
  vi.advanceTimersByTime(1000 - performance.now());
  const probe = h.pick();
  probe.start();
  probe.end(ok);
  expect(h.pick().endpoint).toBe("a");
  probe.done(bad);
  expect(h.pick().endpoint).toBe("b");
});
test("unattributed end releases a probe and done without end uses its result", () => {
  const h = setup();
  h.pick().done(bad);
  vi.advanceTimersByTime(1000 - performance.now());
  const probe = h.pick();
  probe.start();
  probe.end({ attempted: false });
  expect(h.pick().endpoint).toBe("a");
  // That pick now owns the slot, and an unattributed completion frees it.
  const fallback = h.pick(["a"]);
  fallback.done({ attempted: false });
  h.pick().done(ok);
  expect(h.pick().endpoint).toBe("a");
});
test("health forwards end and start while classifying before child callbacks", () => {
  const h = setup();
  h.pick().done(bad);
  vi.advanceTimersByTime(1000 - performance.now());
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

// Coverage-only: uncoded socket results and discarded terminal probe samples.
test("uncoded open resets a streak and invalid probe end stays pending until terminal release", () => {
  let valid = true;
  const h = setup({ isFailure: () => (valid ? true : undefined) });
  h.pick().done(bad);
  vi.advanceTimersByTime(1000 - performance.now());
  const probe = h.pick();
  probe.start();
  valid = false;
  probe.end(ok);
  expect(h.pick().endpoint).toBe("b");
  probe.done(ok);
  expect(h.pick().endpoint).toBe("a");
  const plain = setup({ consecutiveFailures: 2 });
  plain.pick().done(bad);
  plain.pick().done({ attempted: true });
  plain.pick().done(bad);
  expect(plain.pick().endpoint).toBe("a");
});
