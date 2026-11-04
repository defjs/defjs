import { afterEach, expect, test, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { pickEndpoint } from "./runtime";
import type { EndpointPickResult } from "./balancer";
const info = { endpoints: ["a"], transport: "http" as const };
afterEach(() => vi.restoreAllMocks());
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
test.each([1, null, "end"])("invalid end %j rejects a pick", (end) => {
  expect(
    pickEndpoint(
      {
        // @ts-expect-error end must be a function or absent
        pick: () => [null, { endpoint: "a", end }],
      },
      info,
    )[0]?.code,
  ).toBe("REQ_BUILD_FAILED");
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
            get end(): EndpointPickResult["end"] {
              throw cause;
            },
          },
        ],
      },
      info,
    )[0]?.cause,
  ).toBe(cause);
});
test.each(["throw", "reject", "then-getter", "then-call"])(
  "end contains %s and still completes",
  async (mode) => {
    const done = vi.fn();
    const raw: EndpointPickResult & { end(): unknown } = {
      endpoint: "a",
      done,
      end() {
        if (mode === "throw") throw new Error(mode);
        if (mode === "reject") return Promise.reject(new Error(mode));
        if (mode === "then-getter")
          return Object.defineProperty({}, "then", {
            get() {
              throw new Error(mode);
            },
          });
        return {
          then() {
            throw new Error(mode);
          },
        };
      },
    };
    const [, p] = pickEndpoint({ pick: () => [null, raw] }, info);
    if (!p || !("end" in p) || typeof p.end !== "function")
      throw new Error("missing end");
    p.start();
    p.end({ attempted: true });
    p.done({ attempted: true });
    await setImmediate();
    expect(done).toHaveBeenCalledOnce();
  },
);
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
