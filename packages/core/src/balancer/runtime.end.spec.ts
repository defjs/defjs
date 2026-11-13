import { afterEach, expect, test, vi } from "vitest";
import { pickEndpoint } from "./runtime";
import type { PickResult } from "./balancer";
const info = { endpoints: ["a"] };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test("end is snapshotted once and runs synchronously once only after start and before done", () => {
  let reads = 0;
  const events: string[] = [];
  const raw = {
    endpoint: "a",
    start: () => events.push("start"),
    done: () => events.push("done"),
    get end() {
      reads++;
      return () => events.push("end");
    },
  };
  const [, p] = pickEndpoint({ pick: () => [null, raw] }, info);
  if (!p || !("end" in p) || typeof p.end !== "function")
    throw new Error("missing end");
  p.end({ attempted: true });
  expect(events).toEqual([]);
  p.start();
  p.end({ attempted: true });
  p.end({ attempted: true });
  p.done({ attempted: true });
  p.end({ attempted: true });
  expect(events).toEqual(["start", "end", "done"]);
  expect(reads).toBe(1);
});
test("a throwing end getter preserves its cause", () => {
  const cause = new Error("end getter");
  expect(
    pickEndpoint(
      {
        pick: () => [
          null,
          {
            endpoint: "a",
            get end(): PickResult["end"] {
              throw cause;
            },
          },
        ],
      },
      info,
    )[0]?.cause,
  ).toBe(cause);
});
test("end contains a throw and still completes", () => {
  const report = vi.fn();
  vi.stubGlobal("reportError", report);
  const done = vi.fn();
  const raw: PickResult = {
    endpoint: "a",
    done,
    end() {
      throw new Error("end");
    },
  };
  const [, p] = pickEndpoint({ pick: () => [null, raw] }, info);
  if (!p || !("end" in p) || typeof p.end !== "function")
    throw new Error("missing end");
  p.start();
  p.end({ attempted: true });
  p.done({ attempted: true });
  expect(done).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledOnce();
});
test("offline failures are unattributed at end as well as done", () => {
  vi.stubGlobal("navigator", { onLine: false });
  try {
    const end = vi.fn();
    const [, p] = pickEndpoint(
      { pick: () => [null, { endpoint: "a", end }] },
      info,
    );
    if (!p || !("end" in p) || typeof p.end !== "function")
      throw new Error("missing end");
    p.start();
    p.end({ attempted: true, code: "NET_UNREACHABLE" });
    expect(end).toHaveBeenCalledWith({ attempted: false });
  } finally {
    vi.unstubAllGlobals();
  }
});
