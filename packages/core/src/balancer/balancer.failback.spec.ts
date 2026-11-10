import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import { withEndpoint, withBalancer } from "../client/option";
import { defineRequest } from "../http";
import { ERR_NO_CANDIDATE, pickFirstBalancer, type Balancer } from "./balancer";
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

test("failback returns to the first endpoint by time and restarts the time when it fails again", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  const balancer = pickFirstBalancer({ failbackMs: 100 });
  pick(balancer).done?.({ attempted: true, code: "NET_UNREACHABLE" });
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
  vi.advanceTimersByTime(99 - performance.now());
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
  vi.advanceTimersByTime(100 - performance.now());
  const back = pick(balancer);
  expect(back.endpoint).toBe(endpoints[0]);
  expect(pick(balancer).endpoint).toBe(endpoints[0]);
  back.done?.({ attempted: true, code: "NET_UNAVAILABLE" });
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
  vi.advanceTimersByTime(199 - performance.now());
  expect(pick(balancer).endpoint).toBe(endpoints[1]);
  vi.advanceTimersByTime(200 - performance.now());
  expect(pick(balancer).endpoint).toBe(endpoints[0]);
});

test("failback stays on the first endpoint after an unattributed or ordinary outcome", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  const balancer = pickFirstBalancer({ failbackMs: 100 });
  pick(balancer).done?.({ attempted: true, code: "NET_UNREACHABLE" });
  vi.advanceTimersByTime(100);
  const back = pick(balancer);
  expect(back.endpoint).toBe(endpoints[0]);
  back.done?.({ attempted: false });
  pick(balancer).done?.({ attempted: true, code: "NET_TIMEOUT" });
  pick(balancer).done?.({ attempted: true, status: 200 });
  vi.advanceTimersByTime(1000);
  expect(pick(balancer).endpoint).toBe(endpoints[0]);
});

test("an attempt still running on the backup does not move the first endpoint it left", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  const balancer = pickFirstBalancer({ failbackMs: 100 });
  pick(balancer).done?.({ attempted: true, code: "NET_UNREACHABLE" });
  const onBackup = pick(balancer);
  expect(onBackup.endpoint).toBe(endpoints[1]);
  vi.advanceTimersByTime(100);
  expect(pick(balancer).endpoint).toBe(endpoints[0]);
  onBackup.done?.({ attempted: true, code: "NET_UNREACHABLE" });
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

test("a narrowed retry pick keeps the sticky endpoint and leaves failback armed", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  const members = ["https://a.test", "https://b.test", "https://c.test"];
  const balancer = pickFirstBalancer({ failbackMs: 100 });
  const first = balancer.pick({ endpoints: members })[1];
  expect(first?.endpoint).toBe("https://a.test");
  first?.done?.({ attempted: true, code: "NET_TIMEOUT" });
  const retry = balancer.pick({ endpoints: members.slice(1), members })[1];
  expect(retry?.endpoint).toBe("https://b.test");
  retry?.done?.({ attempted: true, status: 200 });
  expect(balancer.pick({ endpoints: members })[1]?.endpoint).toBe(
    "https://a.test",
  );

  balancer
    .pick({ endpoints: members })[1]
    ?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
  const away = balancer.pick({ endpoints: ["https://c.test"], members })[1];
  expect(away?.endpoint).toBe("https://c.test");
  away?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
  expect(balancer.pick({ endpoints: members })[1]?.endpoint).toBe(
    "https://b.test",
  );
  vi.advanceTimersByTime(100);
  expect(balancer.pick({ endpoints: members })[1]?.endpoint).toBe(
    "https://a.test",
  );
});

test("failback does not return to a first endpoint the pick leaves out, so a failing backup still advances", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  const members = ["https://a.test", "https://b.test", "https://c.test"];
  const withoutFirst = members.slice(1);
  const balancer = pickFirstBalancer({ failbackMs: 100 });
  balancer
    .pick({ endpoints: members })[1]
    ?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
  vi.advanceTimersByTime(100);
  const onBackup = balancer.pick({ endpoints: withoutFirst, members })[1];
  expect(onBackup?.endpoint).toBe("https://b.test");
  onBackup?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
  expect(balancer.pick({ endpoints: withoutFirst, members })[1]?.endpoint).toBe(
    "https://c.test",
  );
});

test("a sticky endpoint outside the pick wraps through member order", () => {
  const members = ["https://a.test", "https://b.test", "https://c.test"];
  const balancer = pickFirstBalancer();
  balancer
    .pick({ endpoints: members })[1]
    ?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
  balancer
    .pick({ endpoints: members })[1]
    ?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
  expect(
    balancer.pick({
      endpoints: ["https://a.test", "https://b.test"],
      members,
    })[1]?.endpoint,
  ).toBe("https://a.test");
  expect(balancer.pick({ endpoints: members })[1]?.endpoint).toBe(
    "https://c.test",
  );
  expect(
    balancer.pick({ endpoints: ["https://z.test"], members })[1]?.endpoint,
  ).toBe("https://z.test");
});

test("sparse runtime member and candidate arrays cannot produce an undefined endpoint", () => {
  const members = new Array<string>(2);
  members[0] = "https://member.test";
  expect(
    pickFirstBalancer().pick({ endpoints: new Array<string>(1), members })[0],
  ).toBe(ERR_NO_CANDIDATE);
});
