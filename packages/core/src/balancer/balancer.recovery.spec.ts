import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Balancer, DoneInfo } from "./balancer";
import { pickFirstBalancer, roundRobinBalancer } from "./balancer";
import {
  outlierDetection,
  type OutlierDetectionOptions,
} from "./outlier_detection";
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
const failed: DoneInfo = { attempted: true, code: "NET_UNAVAILABLE" };
const ok: DoneInfo = { attempted: true, status: 200 };
const list = ["a", "b", "c"];
function pick(b: Balancer, endpoints = list) {
  const [err, result] = b.pick({ endpoints });
  expect(err).toBeNull();
  if (!result) throw new Error("missing selection");
  return result;
}
function setup(options: OutlierDetectionOptions = {}) {
  let candidates: readonly string[] = [];
  const childStart = vi.fn();
  const b = outlierDetection(
    {
      pick(info) {
        candidates = info.endpoints;
        return [
          null,
          {
            endpoint: info.endpoints[0] ?? "",
            start: childStart,
          },
        ];
      },
    },
    {
      minPenaltyMs: 100,
      jitterRatio: 0,
      consecutiveFailures: 2,
      ...options,
    },
  );
  pick(b).done?.(failed);
  pick(b).done?.(failed);
  vi.advanceTimersByTime(100 - performance.now());
  return {
    b,
    candidates: () => candidates,
    childStart,
  };
}

test("expiry puts the endpoint back for every concurrent round-robin pick", () => {
  const b = roundRobinBalancer({ outlierDetection: {} });
  let failures = 0;
  while (failures < 5) {
    const p = pick(b);
    if (p.endpoint === "a") failures++;
    p.done?.(p.endpoint === "a" ? failed : ok);
  }
  vi.advanceTimersByTime(1000 - performance.now());
  const wave = Array.from({ length: 60 }, () => pick(b));
  expect(wave.filter((p) => p.endpoint === "a")).toHaveLength(20);
});

test("failures after expiry count again and eject with the next multiplier", () => {
  const h = setup();
  pick(h.b).done?.(failed);
  expect(pick(h.b).endpoint).toBe("a");
  pick(h.b).done?.(failed);
  expect(pick(h.b).endpoint).toBe("b");
  vi.advanceTimersByTime(299 - performance.now());
  expect(pick(h.b).endpoint).toBe("b");
  vi.advanceTimersByTime(300 - performance.now());
  expect(pick(h.b).endpoint).toBe("a");
});

test("an unattributed sample after expiry neither counts nor resets", () => {
  const h = setup();
  pick(h.b).done?.(failed);
  pick(h.b).done?.({ attempted: false });
  expect(pick(h.b).endpoint).toBe("a");
  pick(h.b).done?.(failed);
  expect(pick(h.b).endpoint).toBe("b");
});

test("failback waits for both its interval and the end of an ejection", () => {
  const b = pickFirstBalancer({
    failbackMs: 50,
    outlierDetection: {
      consecutiveFailures: 2,
      minPenaltyMs: 100,
      jitterRatio: 0,
    },
  });
  const first = pick(b);
  const overlap = pick(b);
  first.done?.(failed);
  overlap.done?.(failed);
  pick(b).done?.(ok);
  vi.advanceTimersByTime(50 - performance.now());
  expect(pick(b).endpoint).toBe("b");
  vi.advanceTimersByTime(99 - performance.now());
  expect(pick(b).endpoint).toBe("b");
  vi.advanceTimersByTime(100 - performance.now());
  expect(pick(b).endpoint).toBe("a");
  expect(pick(b).endpoint).toBe("a");
});

test("health filtering forwards the child start callback unchanged", () => {
  const h = setup();
  const probe = pick(h.b);
  expect(probe.start).toBe(h.childStart);
});

test.each([
  { halfOpen: 1 },
  { halfOpen: null },
  { probeTimeoutMs: "1" },
  { probeTimeoutMs: 0 },
  { probeTimeoutMs: -1 },
  { probeTimeoutMs: Infinity },
  { probeTimeoutMs: NaN },
  { slowStartWindowMs: "1" },
  { slowStartWindowMs: -1 },
  { slowStartWindowMs: Infinity },
  { slowStartWindowMs: NaN },
  { slowStartMinWeightPercent: "1" },
  { slowStartMinWeightPercent: 0 },
  { slowStartMinWeightPercent: -1 },
  { slowStartMinWeightPercent: 101 },
  { slowStartMinWeightPercent: NaN },
  { slowStartMinWeightPercent: Infinity },
])(
  "invalid recovery option %j yields REQ_OPTIONS_INVALID in every factory",
  (options) => {
    for (const b of [
      // @ts-expect-error invalid recovery options are rejected at runtime
      outlierDetection(pickFirstBalancer(), options),
      // @ts-expect-error invalid recovery options are rejected at runtime
      pickFirstBalancer({ outlierDetection: options }),
      // @ts-expect-error invalid recovery options are rejected at runtime
      roundRobinBalancer({ outlierDetection: options }),
      // @ts-expect-error invalid recovery options are rejected at runtime
      p2cBalancer({ outlierDetection: options }),
    ]) {
      expect(pickEndpoint(b, { endpoints: list })[0]?.code).toBe(
        "REQ_OPTIONS_INVALID",
      );
    }
  },
);

// Boundary combinations of the ejection and health transitions above.
test("an expired endpoint is selectable again while isHealthy keeps deciding", () => {
  let healthy = (endpoint: string) => endpoint !== "a";
  const h = setup({ isHealthy: (endpoint) => healthy(endpoint) });
  pick(h.b);
  expect(h.candidates()).toEqual(["b", "c"]);
  healthy = () => true;
  pick(h.b);
  expect(h.candidates()).toBe(list);
});

test("an attempt that began before an ejection is ignored after the endpoint returns", () => {
  const b = outlierDetection(
    { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
    { consecutiveFailures: 2, minPenaltyMs: 100, jitterRatio: 0 },
  );
  const older = pick(b);
  pick(b).done?.(failed);
  pick(b).done?.(failed);
  vi.advanceTimersByTime(100 - performance.now());
  older.done?.(failed);
  pick(b).done?.(failed);
  expect(pick(b).endpoint).toBe("a");
  pick(b).done?.(failed);
  expect(pick(b).endpoint).toBe("b");
});

test("an attempt that began while its endpoint was ejected is ignored after the endpoint returns", () => {
  const b = outlierDetection(
    { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
    { consecutiveFailures: 2, minPenaltyMs: 100, jitterRatio: 0 },
  );
  pick(b, ["a"]).done?.(failed);
  pick(b, ["a"]).done?.(failed);
  const failOpen = pick(b, ["a"]);
  vi.advanceTimersByTime(100 - performance.now());
  failOpen.done?.(failed);
  pick(b, list).done?.(failed);
  expect(pick(b, list).endpoint).toBe("a");
  pick(b, list).done?.(failed);
  expect(pick(b, list).endpoint).toBe("b");
});
