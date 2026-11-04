import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { EndpointBalancer, EndpointDoneInfo } from "./balancer";
import { pickFirstBalancer, roundRobinBalancer } from "./balancer";
import {
  outlierDetection,
  type OutlierDetectionOptions,
} from "./outlier_detection";
import { p2cBalancer } from "./p2c";
import { pickEndpoint } from "./runtime";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const failed: EndpointDoneInfo = { attempted: true, status: 503 };
const ok: EndpointDoneInfo = { attempted: true, status: 200 };
const list = ["a", "b", "c"];
function pick(b: EndpointBalancer, endpoints = list) {
  const [err, result] = b.pick({ endpoints, transport: "http" });
  expect(err).toBeNull();
  if (!result) throw new Error("missing selection");
  return result;
}
function setup(options: OutlierDetectionOptions = {}) {
  let desired = "a";
  let candidates: readonly string[] = [];
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
  vi.setSystemTime(100);
  return {
    b,
    candidates: () => candidates,
    desire: (value: string) => {
      desired = value;
    },
    childStart,
  };
}

test("default recovery admits only one probe among sixty concurrent round-robin picks", () => {
  const b = roundRobinBalancer();
  let failures = 0;
  while (failures < 5) {
    const p = pick(b);
    if (p.endpoint === "a") failures++;
    p.done?.(p.endpoint === "a" ? failed : ok);
  }
  vi.setSystemTime(1000);
  const wave = Array.from({ length: 60 }, () => pick(b));
  expect(wave.filter((p) => p.endpoint === "a")).toHaveLength(1);
  wave.forEach((p) => p.done?.(ok));
  expect(
    Array.from({ length: 60 }, () => pick(b)).filter((p) => p.endpoint === "a"),
  ).toHaveLength(20);
});

test("failed probe immediately re-ejects with the next multiplier", () => {
  const h = setup();
  pick(h.b).done?.(failed);
  expect(pick(h.b).endpoint).toBe("b");
  vi.setSystemTime(299);
  expect(pick(h.b).endpoint).toBe("b");
  vi.setSystemTime(300);
  expect(pick(h.b).endpoint).toBe("a");
});

test("unattempted probe releases only its slot and permits another single probe", () => {
  const h = setup();
  const probe = pick(h.b);
  expect(pick(h.b).endpoint).toBe("b");
  probe.done?.({ attempted: false });
  expect(pick(h.b).endpoint).toBe("a");
  expect(pick(h.b).endpoint).toBe("b");
});

test("a child that skips a recovering candidate leaves its probe slot available", () => {
  const h = setup();
  h.desire("b");
  pick(h.b);
  h.desire("a");
  expect(pick(h.b).endpoint).toBe("a");
  expect(pick(h.b).endpoint).toBe("b");
});

test("failback and half-open share the first endpoint without admitting a second probe", () => {
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
  vi.setSystemTime(100);
  const probe = pick(b);
  expect(probe.endpoint).toBe("a");
  expect(pick(b).endpoint).toBe("b");
  probe.done?.(failed);
  expect(pick(b).endpoint).toBe("b");
  vi.setSystemTime(150);
  expect(pick(b).endpoint).toBe("b");
  vi.setSystemTime(299);
  expect(pick(b).endpoint).toBe("b");
  vi.setSystemTime(300);
  const recovered = pick(b);
  expect(recovered.endpoint).toBe("a");
  expect(pick(b).endpoint).toBe("b");
  recovered.done?.(ok);
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
      expect(
        pickEndpoint(b, { endpoints: list, transport: "http" })[0]?.code,
      ).toBe("REQ_OPTIONS_INVALID");
    }
  },
);

// Coverage-only: boundary combinations of the recovery transitions exercised above.
test("a fallback pick can occupy the probe when every active check excludes recovery", () => {
  let active = false;
  const h = setup({ isHealthy: () => active });
  expect(pick(h.b, ["a"]).endpoint).toBe("a");
  active = true;
  pick(h.b);
  expect(h.candidates()).toEqual(["b", "c"]);
});

test("successful half-open probe resets failures from older attempts completed after expiry", () => {
  const b = outlierDetection(
    { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
    { consecutiveFailures: 2, minPenaltyMs: 100, jitterRatio: 0 },
  );
  const older = pick(b);
  pick(b).done?.(failed);
  pick(b).done?.(failed);
  vi.setSystemTime(100);
  const probe = pick(b);
  older.done?.(failed);
  probe.done?.(ok);
  pick(b).done?.(failed);
  expect(pick(b).endpoint).toBe("a");
});

test("a fail-open fallback selecting an occupied half-open host still completes the probe", () => {
  const h = setup();
  const first = pick(h.b);
  const fallback = pick(h.b, ["a"]);
  fallback.done?.(failed);
  first.done?.({ attempted: false });
  expect(pick(h.b).endpoint).toBe("b");
  vi.setSystemTime(299);
  expect(pick(h.b).endpoint).toBe("b");
  vi.setSystemTime(300);
  expect(pick(h.b).endpoint).toBe("a");
});
