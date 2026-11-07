import { afterEach, expect, test, vi } from "vitest";
import { monotonicNow } from "./clock";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test("performance clock follows elapsed time rather than wall clock corrections", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  const initial = monotonicNow();
  vi.setSystemTime(86_400_000);
  expect(monotonicNow()).toBe(initial);
  vi.advanceTimersByTime(100);
  expect(monotonicNow()).toBe(initial + 100);
});
test("platforms without Performance fall back to Date", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(123);
  vi.stubGlobal("performance", undefined);
  expect(monotonicNow()).toBe(123);
});
