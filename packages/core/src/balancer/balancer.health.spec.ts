import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Balancer, DoneInfo, PickInfo } from "./balancer";
import {
  ERR_NO_CANDIDATE,
  pickFirstBalancer,
  roundRobinBalancer,
} from "./balancer";
import {
  outlierDetection,
  type OutlierDetectionOptions,
} from "./outlier_detection";
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
const failure: DoneInfo = { attempted: true, code: "NET_UNREACHABLE" };
const success: DoneInfo = { attempted: true, status: 200 };
function setup(options?: OutlierDetectionOptions) {
  let desired = "a";
  let candidates: readonly string[] = [];
  const childDone = vi.fn();
  const child: Balancer = {
    pick(info) {
      candidates = info.endpoints;
      const endpoint = info.endpoints.includes(desired)
        ? desired
        : info.endpoints[0];
      return endpoint === undefined
        ? [ERR_NO_CANDIDATE, undefined]
        : [null, { endpoint, done: childDone }];
    },
  };
  const balancer = outlierDetection(child, options);
  function pick(endpoints: readonly string[] = ["a", "b", "c"]) {
    const result = balancer.pick({
      endpoints,

      operation: "read",
    });
    expect(result[0]).toBeNull();
    return result[1];
  }
  function report(
    endpoint: string,
    info: DoneInfo = failure,
    endpoints?: readonly string[],
  ) {
    desired = endpoint;
    const result = pick(endpoints);
    expect(result?.endpoint).toBe(endpoint);
    result?.done?.(info);
  }
  return { balancer, childDone, pick, report, candidates: () => candidates };
}

test("active true never cancels passive ejection and invalid active results only fail one pick", () => {
  let active: unknown = true;
  const h = setup({
    consecutiveFailures: 1,
    // @ts-expect-error active results are not always booleans
    isHealthy: () => active,
  });
  h.report("a");
  h.pick();
  expect(h.candidates()).toEqual(["b", "c"]);
  active = "true";
  expect(pickEndpoint(h.balancer, { endpoints: ["a", "b"] })[0]?.code).toBe(
    "REQ_OPTIONS_INVALID",
  );
  active = true;
  h.pick();
  expect(h.candidates()).toEqual(["b", "c"]);
});

test("throwing and nonboolean failure callbacks neither count nor reset and always forward done", () => {
  let mode = 0;
  const h = setup({
    consecutiveFailures: 2,
    // @ts-expect-error undefined is not a boolean failure result
    isFailure: () => {
      if (mode === 1) throw new Error("callback");
      return mode === 2 ? undefined : true;
    },
  });
  h.report("a");
  mode = 1;
  h.report("a");
  mode = 2;
  h.report("a");
  expect(h.childDone).toHaveBeenCalledTimes(3);
  h.pick();
  expect(h.candidates()).toContain("a");
  mode = 0;
  h.report("a");
  h.pick();
  expect(h.candidates()).not.toContain("a");
});

test("disabled consecutive failures never break an endpoint", () => {
  const h = setup({ consecutiveFailures: 0 });
  for (let i = 0; i < 20; i += 1) h.report("a", failure, ["a", "b"]);
  h.pick(["a", "b"]);
  expect(h.candidates()).toEqual(["a", "b"]);
});

test("last-available and done never consult isHealthy; a thrown active check only rejects that pick", () => {
  let throws = false;
  const active = vi.fn(() => {
    if (throws) throw new Error("active");
    return true;
  });
  const h = setup({ consecutiveFailures: 1, isHealthy: active });
  const result = h.pick();
  const calls = active.mock.calls.length;
  throws = true;
  result?.done?.(failure);
  expect(active).toHaveBeenCalledTimes(calls);
  expect(pickEndpoint(h.balancer, { endpoints: ["a", "b"] })[0]?.code).toBe(
    "REQ_OPTIONS_INVALID",
  );
  throws = false;
  h.pick();
  expect(h.candidates()).not.toContain("a");
});

test("active filtering calls once, preserves full-list identity and forwards metadata", () => {
  const list = Object.freeze(["a", "b"]);
  const active = vi.fn(() => true);
  let received: PickInfo | undefined;
  const h = outlierDetection(
    {
      pick(info) {
        received = info;
        return [null, { endpoint: info.endpoints[0] ?? "" }];
      },
    },
    { isHealthy: active },
  );
  const info: PickInfo = {
    endpoints: list,
    operation: "read",
  };
  expect(h.pick(info)[0]).toBeNull();
  expect(received?.endpoints).toBe(list);
  expect(received?.operation).toBe("read");
  expect(received).not.toHaveProperty("transport");
  expect(active).toHaveBeenCalledTimes(2);
});

test("active-all-false falls back but still respects passive ejections", () => {
  let active = true;
  const h = setup({ consecutiveFailures: 1, isHealthy: () => active });
  h.report("a");
  active = false;
  h.pick();
  expect(h.candidates()).toEqual(["b", "c"]);
});

test("uncoded 5xx ejects by default; timeout, incomplete body and unattributed outcomes do not", () => {
  const h = setup({ consecutiveFailures: 2 });
  h.report("a", { attempted: true, code: "NET_UNAVAILABLE" });
  h.report("a", { attempted: false });
  h.report("a", { attempted: true, code: "NET_UNAVAILABLE" });
  h.pick();
  expect(h.candidates()).not.toContain("a");
  for (const code of ["NET_TIMEOUT", "NET_BODY_INCOMPLETE"] as const) {
    const safe = setup({ consecutiveFailures: 1 });
    safe.report("a", { attempted: true, code, status: 503 });
    safe.pick();
    expect(safe.candidates()).toContain("a");
  }
});

test("built-in configuration matches the exported wrapper and false restores no-done round robin", () => {
  expect(
    roundRobinBalancer({ outlierDetection: false }).pick({
      endpoints: ["a"],
    })[1]?.done,
  ).toBeUndefined();
  const balancer = pickFirstBalancer({
    outlierDetection: { consecutiveFailures: 1 },
  });
  balancer
    .pick({ endpoints: ["a", "b"] })[1]
    ?.done?.({ attempted: true, code: "NET_SERVER_ERROR" });
  expect(balancer.pick({ endpoints: ["a", "b"] })[1]?.endpoint).toBe("b");
});

test("invalid health option types and ranges become persistent REQ_OPTIONS_INVALID", () => {
  const cases: unknown[] = [
    null,
    true,
    [],
    1,
    { intervalMs: "1" },
    { intervalMs: 0 },
    { baseEjectionMs: -1 },
    { maxEjectionMs: Infinity },
    { maxEjectionPercent: "10" },
    { maxEjectionPercent: -1 },
    { maxEjectionPercent: 101 },
    { maxEjectionPercent: NaN },
    { consecutiveFailures: "5" },
    { consecutiveFailures: -1 },
    { consecutiveFailures: 1.5 },
    { consecutiveFailures: Number.MAX_SAFE_INTEGER + 1 },
    { failurePercentage: false },
    { failurePercentage: { threshold: "85" } },
    { failurePercentage: { threshold: 101 } },
    { failurePercentage: { minimumHosts: -1 } },
    { failurePercentage: { requestVolume: "50" } },
    { isFailure: 1 },
    { isHealthy: true },
  ];
  for (const options of cases) {
    for (const balancer of [
      // @ts-expect-error invalid health options are rejected at runtime
      outlierDetection(pickFirstBalancer(), options),
      // @ts-expect-error invalid health options are rejected at runtime
      roundRobinBalancer({ outlierDetection: options }),
      // @ts-expect-error invalid health options are rejected at runtime
      pickFirstBalancer({ outlierDetection: options }),
    ]) {
      const [first] = balancer.pick({ endpoints: ["a"] });
      expect(first).toBeInstanceOf(Error);
      expect(balancer.pick({ endpoints: [] })[0]).toBe(first);
      expect(pickEndpoint(balancer, { endpoints: ["a"] })[0]?.code).toBe(
        "REQ_OPTIONS_INVALID",
      );
    }
  }
});

test("success resets a failure streak but unattributed done does not", () => {
  const h = setup({ consecutiveFailures: 2 });
  h.report("a");
  h.report("a", success);
  h.report("a");
  h.pick();
  expect(h.candidates()).toContain("a");
  h.report("a", { attempted: false });
  h.report("a");
  h.pick();
  expect(h.candidates()).not.toContain("a");
});

test("child errors pass through and unknown child selections still receive their done", () => {
  const err = new Error("selection");
  expect(
    outlierDetection({ pick: () => [err, undefined] }).pick({
      endpoints: [],
    }),
  ).toEqual([err, undefined]);
  const done = vi.fn();
  const b = outlierDetection({
    pick: () => [null, { endpoint: "external", done }],
  });
  b.pick({ endpoints: ["a"] })[1]?.done?.(failure);
  expect(done).toHaveBeenCalledWith(failure);
});

test("unfiltered round robin resolves and finishes once without a done callback", () => {
  const [, resolved] = pickEndpoint(
    roundRobinBalancer({ outlierDetection: false }),
    { endpoints: ["a"] },
  );
  expect(resolved?.finished()).toBe(false);
  resolved?.done({ attempted: false });
  resolved?.done(success);
  expect(resolved?.finished()).toBe(true);
});
