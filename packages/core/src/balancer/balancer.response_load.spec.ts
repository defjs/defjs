import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { p2cBalancer } from "./p2c";
import { pickEndpoint } from "./runtime";
import type { EndpointBalancer, EndpointTransport } from "./balancer";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function pick(
  b: EndpointBalancer,
  endpoints = ["a", "b"],
  transport: EndpointTransport = "http",
) {
  const [, p] = pickEndpoint(b, { endpoints, transport });
  if (!p) throw new Error("pick");
  return p;
}
test("pending is released at end, not at done, including a single candidate", () => {
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const a = pick(b, ["a"]);
  a.start();
  expect(pick(b).endpoint).toBe("b");
  a.end({ attempted: true });
  expect(pick(b).endpoint).toBe("a");
  a.done({ attempted: false });
  expect(pick(b).endpoint).toBe("a");
});
test.each(["http", "sse", "websocket"] as const)(
  "%s RTT uses start to end, never interceptor or session lifetime",
  (transport) => {
    const b = p2cBalancer({ defaultRttMs: 1, outlierDetection: false });
    const slow = pick(b, ["b"], transport);
    slow.start();
    vi.setSystemTime(50);
    slow.end({ attempted: true });
    const fast = pick(b, ["a"], transport);
    vi.setSystemTime(130);
    fast.start();
    vi.setSystemTime(140);
    fast.end({ attempted: true });
    vi.setSystemTime(220);
    expect(pick(b).endpoint).toBe("a");
    fast.done({ attempted: true });
  },
);
test("quick failures use real RTT rather than a default penalty", () => {
  const b = p2cBalancer({
    defaultRttMs: 1,
    decayMs: 1000000,
    outlierDetection: false,
  });
  const a = pick(b, ["a"]);
  a.start();
  vi.setSystemTime(50);
  a.end({ attempted: true });
  const failed = pick(b, ["b"]);
  failed.start();
  vi.setSystemTime(51);
  failed.end({ attempted: true, code: "NET_UNREACHABLE" });
  expect(pick(b).endpoint).toBe("b");
});
test("default RTT is Linkerd's thirty milliseconds", () => {
  const b = p2cBalancer({ outlierDetection: false });
  const a = pick(b, ["a"]);
  a.start();
  vi.setSystemTime(50);
  a.end({ attempted: true });
  expect(pick(b).endpoint).toBe("b");
});
test("done without end releases pending but cannot produce an RTT sample", () => {
  const b = p2cBalancer({ defaultRttMs: 1, outlierDetection: false });
  const a = pick(b, ["a"]);
  a.start();
  vi.setSystemTime(2000);
  a.done({ attempted: true });
  expect(pick(b).endpoint).toBe("a");
});
test("removed p2c classifier is an option error even when it is a function", () => {
  // @ts-expect-error isFailure was removed from p2c options
  const b = p2cBalancer({ isFailure: () => true });
  expect(
    pickEndpoint(b, { endpoints: ["a"], transport: "http" })[0]?.code,
  ).toBe("REQ_OPTIONS_INVALID");
});

// Coverage-only: direct callers bypassing the runtime's lifecycle guards.
test("raw p2c end ignores unstarted, ended and terminal attempts", () => {
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const [, raw] = b.pick({ endpoints: ["a"], transport: "http" });
  raw?.end?.({ attempted: true });
  raw?.start?.();
  raw?.end?.({ attempted: true });
  raw?.end?.({ attempted: true });
  raw?.done?.({ attempted: true });
  raw?.end?.({ attempted: true });
  const [, terminal] = b.pick({ endpoints: ["a"], transport: "http" });
  terminal?.start?.();
  terminal?.done?.({ attempted: false });
  terminal?.end?.({ attempted: true });
  expect(pick(b).endpoint).toBe("a");
});
