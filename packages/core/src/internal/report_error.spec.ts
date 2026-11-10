import { afterEach, expect, test, vi } from "vitest";
import { reportContainedError } from "./report_error";

afterEach(() => vi.unstubAllGlobals());

test("reports the contained value itself", () => {
  const report = vi.fn();
  vi.stubGlobal("reportError", report);
  const error = new Error("contained");
  reportContainedError(error);
  expect(report).toHaveBeenCalledExactlyOnceWith(error);
});

test("stays silent when the runtime has no reportError", () => {
  vi.stubGlobal("reportError", undefined);
  expect(() => reportContainedError(new Error("contained"))).not.toThrow();
});

test("never throws when reportError itself throws", () => {
  vi.stubGlobal("reportError", () => {
    throw new Error("report failed");
  });
  expect(() => reportContainedError(new Error("contained"))).not.toThrow();
});
