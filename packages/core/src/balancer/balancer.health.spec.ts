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
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
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
      meta: { operation: "read" },
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

test("isHealthy true never cancels passive ejection", () => {
  const h = setup({ consecutiveFailures: 1, isHealthy: () => true });
  h.report("a");
  h.pick();
  expect(h.candidates()).toEqual(["b", "c"]);
});

test("a throwing isFailure comes out of done after the child has been told", () => {
  let throws = false;
  const h = setup({
    consecutiveFailures: 1,
    isFailure: () => {
      if (throws) throw new Error("callback");
      return true;
    },
  });
  throws = true;
  expect(() => h.report("a")).toThrow("callback");
  expect(h.childDone).toHaveBeenCalledOnce();
  h.pick();
  expect(h.candidates()).toContain("a");
  throws = false;
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

test("done never consults isHealthy and a throw from it comes out of pick", () => {
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
  expect(() => h.balancer.pick({ endpoints: ["a", "b"] })).toThrow("active");
  throws = false;
  h.pick();
  expect(h.candidates()).not.toContain("a");
});

test.each<[string, unknown]>([
  ["an Error", new Error("boom")],
  ["a RangeError", new RangeError("range")],
  ["a string", "plain"],
])(
  "reports %s thrown by isHealthy as the cause of REQ_BUILD_FAILED",
  (_name, thrown) => {
    const child: Balancer = { pick: () => [null, { endpoint: "a" }] };
    const [fault, selected] = pickEndpoint(
      outlierDetection(child, {
        isHealthy: () => {
          throw thrown;
        },
      }),
      { endpoints: ["a", "b"] },
    );
    expect(selected).toBeUndefined();
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(thrown);
  },
);

test("isHealthy is consulted only for endpoints that are not ejected", () => {
  const asked: string[] = [];
  const h = setup({
    consecutiveFailures: 1,
    isHealthy: (endpoint) => {
      asked.push(endpoint);
      return true;
    },
  });
  h.report("a");
  asked.length = 0;
  h.pick();
  expect(asked).toEqual(["b", "c"]);
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
    meta: { operation: "read" },
  };
  expect(h.pick(info)[0]).toBeNull();
  expect(received?.endpoints).toBe(list);
  expect(received?.meta).toEqual({ operation: "read" });
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

test("every coded outcome ejects by default, including timeout and incomplete body; unattributed outcomes do not", () => {
  const h = setup({ consecutiveFailures: 2 });
  h.report("a", { attempted: true, code: "NET_UNAVAILABLE" });
  h.report("a", { attempted: false });
  h.report("a", { attempted: true, code: "NET_UNAVAILABLE" });
  h.pick();
  expect(h.candidates()).not.toContain("a");
  for (const code of ["NET_TIMEOUT", "NET_BODY_INCOMPLETE"] as const) {
    const failing = setup({ consecutiveFailures: 1 });
    failing.report("a", { attempted: true, code });
    failing.pick();
    expect(failing.candidates()).not.toContain("a");
  }
});

test("a timeout between failures extends the streak instead of resetting it", () => {
  const h = setup({ consecutiveFailures: 3 });
  h.report("a", { attempted: true, code: "NET_UNAVAILABLE" });
  h.report("a", { attempted: true, code: "NET_TIMEOUT" });
  h.pick();
  expect(h.candidates()).toContain("a");
  h.report("a", { attempted: true, code: "NET_UNAVAILABLE" });
  h.pick();
  expect(h.candidates()).not.toContain("a");
});

test("round robin filters health only when outlierDetection is supplied", () => {
  expect(
    roundRobinBalancer().pick({ endpoints: ["a"] })[1]?.done,
  ).toBeUndefined();
  expect(
    roundRobinBalancer({ outlierDetection: false }).pick({
      endpoints: ["a"],
    })[1]?.done,
  ).toBeUndefined();
  expect(
    roundRobinBalancer({ outlierDetection: {} }).pick({
      endpoints: ["a"],
    })[1]?.done,
  ).toBeTypeOf("function");
  const balancer = pickFirstBalancer({
    outlierDetection: { consecutiveFailures: 1 },
  });
  balancer
    .pick({ endpoints: ["a", "b"] })[1]
    ?.done?.({ attempted: true, code: "NET_SERVER_ERROR" });
  expect(balancer.pick({ endpoints: ["a", "b"] })[1]?.endpoint).toBe("b");
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

test("child errors pass through", () => {
  const err = new Error("selection");
  expect(
    outlierDetection({ pick: () => [err, undefined] }).pick({
      endpoints: [],
    }),
  ).toEqual([err, undefined]);
});
