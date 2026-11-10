import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { p2cBalancer } from "./p2c";
import { pickEndpoint } from "./runtime";
import type { Balancer } from "./balancer";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function pick(b: Balancer, endpoints = ["a", "b"]) {
  const [, p] = pickEndpoint(b, { endpoints });
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
test("RTT uses start to end, never interceptor or session lifetime", () => {
  const b = p2cBalancer({ defaultRttMs: 1, outlierDetection: false });
  const slow = pick(b, ["b"]);
  slow.start();
  vi.advanceTimersByTime(50 - performance.now());
  slow.end({ attempted: true });
  const fast = pick(b, ["a"]);
  vi.advanceTimersByTime(130 - performance.now());
  fast.start();
  vi.advanceTimersByTime(140 - performance.now());
  fast.end({ attempted: true });
  vi.advanceTimersByTime(220 - performance.now());
  expect(pick(b).endpoint).toBe("a");
  fast.done({ attempted: true });
});
test("quick failures use real RTT rather than a default penalty", () => {
  const b = p2cBalancer({
    defaultRttMs: 1,
    decayMs: 1000000,
    outlierDetection: false,
  });
  const a = pick(b, ["a"]);
  a.start();
  vi.advanceTimersByTime(50 - performance.now());
  a.end({ attempted: true });
  const failed = pick(b, ["b"]);
  failed.start();
  vi.advanceTimersByTime(51 - performance.now());
  failed.end({ attempted: true, code: "NET_UNREACHABLE" });
  expect(pick(b).endpoint).toBe("b");
});
test("default RTT is Linkerd's thirty milliseconds", () => {
  const b = p2cBalancer({ outlierDetection: false });
  const a = pick(b, ["a"]);
  a.start();
  vi.advanceTimersByTime(50 - performance.now());
  a.end({ attempted: true });
  expect(pick(b).endpoint).toBe("b");
});
test("done without end releases pending but cannot produce an RTT sample", () => {
  const b = p2cBalancer({ defaultRttMs: 1, outlierDetection: false });
  const a = pick(b, ["a"]);
  a.start();
  vi.advanceTimersByTime(2000 - performance.now());
  a.done({ attempted: true });
  expect(pick(b).endpoint).toBe("a");
});
// Direct callers bypass the runtime's lifecycle guards.
test("raw p2c end ignores unstarted, ended and terminal attempts", () => {
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const [, raw] = b.pick({ endpoints: ["a"] });
  raw?.end?.({ attempted: true });
  raw?.start?.();
  raw?.end?.({ attempted: true });
  raw?.end?.({ attempted: true });
  raw?.done?.({ attempted: true });
  raw?.end?.({ attempted: true });
  const [, terminal] = b.pick({ endpoints: ["a"] });
  terminal?.start?.();
  terminal?.done?.({ attempted: false });
  terminal?.end?.({ attempted: true });
  expect(pick(b).endpoint).toBe("a");
});
