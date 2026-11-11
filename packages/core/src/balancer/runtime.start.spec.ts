import { afterEach, expect, test, vi } from "vitest";
import { pickEndpoint } from "./runtime";
import { p2cBalancer } from "./p2c";
import type { Balancer } from "./balancer";

const info = { endpoints: ["a", "b"] };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test("start is snapshotted once, invoked synchronously at most once, and never after done", () => {
  let reads = 0;
  const start = vi.fn();
  const [, p] = pickEndpoint(
    {
      pick: () => [
        null,
        {
          endpoint: "a",
          get start() {
            reads++;
            return start;
          },
        },
      ],
    },
    info,
  );
  p?.start();
  p?.start();
  expect(start).toHaveBeenCalledTimes(1);
  expect(reads).toBe(1);
  const [, other] = pickEndpoint(
    { pick: () => [null, { endpoint: "a", start }] },
    info,
  );
  other?.done({ attempted: false });
  other?.start();
  expect(start).toHaveBeenCalledTimes(1);
});
test("a throwing start getter becomes REQ_BUILD_FAILED without calling done", () => {
  const cause = new Error("getter");
  const done = vi.fn();
  const [fault] = pickEndpoint(
    {
      pick: () => [
        null,
        {
          endpoint: "a",
          done,
          get start(): () => void {
            throw cause;
          },
        },
      ],
    },
    info,
  );
  expect(fault?.cause).toBe(cause);
  expect(done).not.toHaveBeenCalled();
});
test("start contains a throw without changing completion", () => {
  const report = vi.fn();
  vi.stubGlobal("reportError", report);
  const cause = new Error("start");
  const done = vi.fn();
  let calls = 0;
  const [, p] = pickEndpoint(
    {
      pick: () => [
        null,
        {
          endpoint: "a",
          done,
          start() {
            calls++;
            throw cause;
          },
        },
      ],
    },
    info,
  );
  p?.start();
  p?.start();
  p?.done({ attempted: true });
  expect(calls).toBe(1);
  expect(done).toHaveBeenCalledWith({ attempted: true });
  expect(report).toHaveBeenCalledExactlyOnceWith(cause);
});
function pick(b: Balancer, endpoints = ["a", "b"]) {
  const [, p] = pickEndpoint(b, { ...info, endpoints });
  if (!p) throw new Error("missing pick");
  return p;
}
test("p2c pending counts a pick from selection until its response begins", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const waiting = pick(b);
  expect(waiting.endpoint).toBe("a");
  const second = pick(b);
  expect(second.endpoint).toBe("b");
  second.done({ attempted: false });
  waiting.start();
  waiting.end({ attempted: true, status: 200 });
  expect(pick(b).endpoint).toBe("a");
});
test("p2c unstarted done cannot decrement a different single-host transport", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const active = pick(b, ["a"]);
  const unstarted = pick(b, ["a"]);
  active.start();
  unstarted.done({ attempted: false });
  expect(pick(b).endpoint).toBe("b");
  active.done({ attempted: false });
  expect(pick(b).endpoint).toBe("a");
});

// Direct callers bypass the runtime's once-only wrapper.
test("repeated raw p2c starts increment pending only once", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const [, p] = b.pick({ ...info, endpoints: ["a"] });
  p?.start?.();
  p?.start?.();
  p?.done?.({ attempted: false });
  expect(pick(b).endpoint).toBe("a");
});
