import { afterEach, expect, test, vi } from "vitest";
import { pickEndpoint } from "./runtime";
import { p2cBalancer } from "./p2c";
import type { EndpointBalancer } from "./balancer";

const info = { endpoints: ["a", "b"], transport: "http" as const };
afterEach(() => vi.restoreAllMocks());
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
test.each([1, null, "start"])(
  "invalid start %j rejects the pick outcome",
  (start) => {
    const result = { endpoint: "a", start };
    const [fault] = pickEndpoint(
      {
        // @ts-expect-error start must be a function or absent
        pick: () => [null, result],
      },
      info,
    );
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toEqual([null, result]);
  },
);
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
test.each(["throw", "reject", "then-getter", "then-call"])(
  "start contains %s without changing completion",
  async (mode) => {
    const cause = new Error(mode);
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
              if (mode === "throw") throw cause;
              if (mode === "reject") return Promise.reject(cause);
              if (mode === "then-getter")
                return Object.defineProperty({}, "then", {
                  get() {
                    throw cause;
                  },
                });
              return {
                then() {
                  throw cause;
                },
              };
            },
          },
        ],
      },
      info,
    );
    p?.start();
    p?.start();
    p?.done({ attempted: true });
    await Bun.sleep(0);
    expect(calls).toBe(1);
    expect(done).toHaveBeenCalledWith({ attempted: true });
  },
);
function pick(b: EndpointBalancer, endpoints = ["a", "b"]) {
  const [, p] = pickEndpoint(b, { ...info, endpoints });
  if (!p) throw new Error("missing pick");
  return p;
}
test("p2c pending excludes picked interceptor work and counts only started transports", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const waiting = pick(b);
  expect(waiting.endpoint).toBe("a");
  expect(pick(b).endpoint).toBe("a");
  waiting.start();
  expect(pick(b).endpoint).toBe("b");
  waiting.done({ attempted: false });
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

// Coverage-only: direct callers bypassing the runtime's once-only wrapper.
test("repeated raw p2c starts increment pending only once", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const [, p] = b.pick({ ...info, endpoints: ["a"] });
  p?.start?.();
  p?.start?.();
  p?.done?.({ attempted: false });
  expect(pick(b).endpoint).toBe("a");
});
