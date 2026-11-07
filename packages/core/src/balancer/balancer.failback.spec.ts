import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import { withEndpoint, withBalancer } from "../client/option";
import { defineRequest } from "../http";
import { pickFirstBalancer, type Balancer } from "./balancer";
import { pickEndpoint } from "./runtime";

const endpoints = ["https://first.test", "https://second.test"];
function pick(balancer: Balancer) {
  const [error, selected] = balancer.pick({ endpoints });
  if (error) throw error;
  return selected;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("gateway errors advance pick_first but coded body failures do not", () => {
  const balancer = pickFirstBalancer();
  pick(balancer).done?.({
    attempted: true,
    code: "NET_BODY_INCOMPLETE",
    status: 503,
  });
  expect(pick(balancer).endpoint).toBe(endpoints[0]);
  pick(balancer).done?.({ attempted: true, code: "NET_UNAVAILABLE" });
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
});

test("offline connect failures are unattributed; online and absent navigator still advance", () => {
  for (const navigator of [{ onLine: false }, { onLine: true }, undefined]) {
    vi.stubGlobal("navigator", navigator);
    const balancer = pickFirstBalancer();
    const [, selected] = pickEndpoint(balancer, {
      endpoints,
    });
    selected?.done({ attempted: true, code: "NET_UNREACHABLE" });
    expect(pick(balancer).endpoint).toBe(
      navigator?.onLine === false ? endpoints[0] : endpoints[1],
    );
  }
});

test("failback permits one probe, retries failed probes, ignores unattributed probes", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  const balancer = pickFirstBalancer({ failbackMs: 100 });
  pick(balancer).done?.({ attempted: true, code: "NET_UNREACHABLE" });
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
  vi.advanceTimersByTime(100 - performance.now());
  const probe = pick(balancer);
  expect(probe.endpoint).toBe(endpoints[0]);
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
  probe.done?.({ attempted: true, code: "NET_UNAVAILABLE" });
  vi.advanceTimersByTime(199 - performance.now());
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
  vi.advanceTimersByTime(200 - performance.now());
  pick(balancer).done?.({ attempted: false });
  const success = pick(balancer);
  expect(success.endpoint).toBe(endpoints[0]);
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
  success.done?.({ attempted: true, status: 200 });
  expect(pick(balancer).endpoint).toBe(endpoints[0]);
});

test.each([0, -1, Infinity, NaN])(
  "invalid failbackMs %s fails at execution",
  async (failbackMs) => {
    const client = createClient(
      withEndpoint(...endpoints),
      withBalancer(pickFirstBalancer({ failbackMs })),
    );
    const [fault] = await defineRequest({ method: "GET", path: "/" })(client);
    expect(fault?.code).toBe("REQ_OPTIONS_INVALID");
  },
);

test("throwing navigator access is treated as online", () => {
  vi.stubGlobal("navigator", {
    get onLine() {
      throw new Error("blocked");
    },
  });
  const balancer = pickFirstBalancer();
  const [, selected] = pickEndpoint(balancer, { endpoints });
  selected?.done({ attempted: true, code: "NET_UNREACHABLE" });
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
});
