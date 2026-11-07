import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Balancer, DoneInfo } from "./balancer";
import { ERR_NO_CANDIDATE } from "./balancer";
import { p2cBalancer } from "./p2c";
import { pickEndpoint } from "./runtime";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function pick(balancer: Balancer, endpoints = ["a", "b"]) {
  const [error, result] = balancer.pick({ endpoints });
  expect(error).toBeNull();
  if (result === undefined) throw new Error("missing pick");
  expect(result.done).toBeTypeOf("function");
  result.start?.();
  return result;
}
function complete(
  balancer: Balancer,
  endpoint: string,
  report: DoneInfo & { sampleMs?: number },
) {
  const result = pick(balancer, [endpoint]);
  vi.advanceTimersByTime(report.sampleMs ?? 0);
  result.end?.(report);
  result.done?.(report);
}

test("serial peak EWMA eventually samples every host as unused estimates decay", () => {
  const b = p2cBalancer({ outlierDetection: false });
  const seen = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    // Rotate the deterministic two-host sample so each endpoint is eligible.
    vi.mocked(Math.random).mockReturnValue(i % 2 === 0 ? 0 : 0.9);
    const result = pick(b, ["a", "b", "c"]);
    seen.add(result.endpoint);
    vi.advanceTimersByTime(100);
    result.end?.({ attempted: true, status: 200 });
    result.done?.({ attempted: true, status: 200 });
    vi.advanceTimersByTime((i + 1) * 1000 - performance.now());
  }
  expect(seen).toEqual(new Set(["a", "b", "c"]));
});

test("pending mode tracks even single-host starts and decrements every done outcome", () => {
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const a = pick(b, ["a"]);
  expect(pick(b).endpoint).toBe("b");
  a.done?.({ attempted: false });
  expect(pick(b).endpoint).toBe("a");
  a.done?.({ attempted: false });
  a.done?.({ attempted: true, code: "NET_TIMEOUT" });
  expect(pick(b).endpoint).toBe("a");
});

test("peak updates take a larger sample immediately and blend smaller samples over elapsed time", () => {
  const b = p2cBalancer({
    defaultRttMs: 100,
    decayMs: 100,
    outlierDetection: false,
  });
  const a = pick(b, ["a"]);
  vi.advanceTimersByTime(50 - performance.now());
  const other = pick(b, ["b"]);
  vi.advanceTimersByTime(200 - performance.now());
  a.end?.({ attempted: true });
  other.end?.({ attempted: true });
  expect(pick(b).endpoint).toBe("b");
  vi.advanceTimersByTime(300 - performance.now());
  const smaller = pick(b, ["a"]);
  vi.advanceTimersByTime(301 - performance.now());
  smaller.end?.({ attempted: true });
  expect(pick(b, ["a", "fresh"]).endpoint).toBe("a");
});

test("sampling is without replacement and ties favor the first draw", () => {
  const b = p2cBalancer({
    load: "pending",
    choiceCount: 3,
    outlierDetection: false,
  });
  const held = pick(b, ["a"]);
  pick(b, ["b"]);
  expect(pick(b, ["a", "b", "c"]).endpoint).toBe("c");
  held.done?.({ attempted: false });
  vi.mocked(Math.random).mockReturnValue(0.9);
  expect(
    pick(p2cBalancer({ load: "pending", outlierDetection: false }), [
      "a",
      "b",
      "c",
    ]).endpoint,
  ).toBe("c");
});

test("choiceCount is capped at ten and captured at construction", () => {
  const options = {
    choiceCount: 100,
    load: "pending" as const,
    outlierDetection: false as const,
  };
  const b = p2cBalancer(options);
  options.choiceCount = 2;
  const list = Array.from({ length: 11 }, (_, i) => `h${i}`);
  for (const endpoint of list.slice(0, 9)) pick(b, [endpoint]);
  expect(pick(b, list).endpoint).toBe("h9");
});

test("default p2c health filtering ejects a failing host and preserves another", () => {
  const b = p2cBalancer();
  for (let i = 0; i < 5; i += 1)
    complete(b, "a", { attempted: true, code: "NET_UNAVAILABLE" });
  // A lone host can break too; fallback is local to each pick list.
  expect(pick(b).endpoint).toBe("b");
});

test("invalid p2c options are remembered, branded, and never throw", () => {
  const cases: unknown[] = [
    null,
    [],
    1,
    { load: "rtt" },
    { choiceCount: "2" },
    { choiceCount: 1 },
    { choiceCount: 2.5 },
    { choiceCount: Infinity },
    { defaultRttMs: "1" },
    { defaultRttMs: 0 },
    { defaultRttMs: NaN },
    { decayMs: -1 },
    { isFailure: true },
    { outlierDetection: true },
  ];
  for (const options of cases) {
    // @ts-expect-error invalid p2c options are rejected at runtime
    const b = p2cBalancer(options);
    const first = b.pick({ endpoints: ["a"] })[0];
    expect(first).toBeInstanceOf(Error);
    expect(b.pick({ endpoints: [] })[0]).toBe(first);
    expect(pickEndpoint(b, { endpoints: ["a"] })[0]?.code).toBe(
      "REQ_OPTIONS_INVALID",
    );
  }
  expect(p2cBalancer().pick({ endpoints: [] })[0]).toBe(ERR_NO_CANDIDATE);
});

test("state pruning forgets idle absent hosts but retains outstanding picks", () => {
  const b = p2cBalancer({ outlierDetection: false, choiceCount: 10 });
  complete(b, "old", { attempted: true, sampleMs: 2000 });
  const held = pick(b, ["held"]);
  vi.advanceTimersByTime(3000);
  held.end?.({ attempted: true });
  held.done?.({ attempted: true });
  const outstanding = pick(b, ["held"]);
  for (let group = 0; group < 26; group += 1) {
    const fresh = Array.from({ length: 10 }, (_, i) => `new${group}-${i}`);
    pick(b, fresh).done?.({ attempted: false });
  }
  expect(pick(b, ["old", "fresh"]).endpoint).toBe("old");
  expect(pick(b, ["held", "fresh2"]).endpoint).toBe("fresh2");
  outstanding.done?.({ attempted: false });
});

test("a candidate list larger than the history floor keeps every estimate", () => {
  const b = p2cBalancer({ outlierDetection: false });
  complete(b, "slow", { attempted: true, sampleMs: 2000 });
  const many = ["slow", ...Array.from({ length: 299 }, (_, i) => `peer${i}`)];
  expect(pick(b, many).endpoint).toBe("peer0");
});

test("pending is reserved at pick, so a same-tick burst spreads before any start", () => {
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const burst = Array.from({ length: 4 }, () =>
    b.pick({ endpoints: ["a", "b"] }),
  );
  expect(burst.map(([, result]) => result?.endpoint)).toEqual([
    "a",
    "b",
    "a",
    "b",
  ]);
  for (const [, result] of burst) result?.done?.({ attempted: false });
  expect(pick(b).endpoint).toBe("a");
});

test("sparse runtime candidate arrays cannot produce an undefined endpoint", () => {
  const b = p2cBalancer({ outlierDetection: false });
  const empty = new Array<string>(1);
  expect(b.pick({ endpoints: empty })[0]).toBe(ERR_NO_CANDIDATE);
  const sparse = new Array<string>(2);
  sparse[1] = "a";
  expect(pick(b, sparse).endpoint).toBe("a");
});

test.each([8_000_000, 8_000_000_000_000])(
  "clock rollback by %i ms preserves the concurrent selection baseline after recovery",
  (rollbackMs) => {
    const now = 10_000_000;
    vi.setSystemTime(now);
    const baseline = p2cBalancer({ outlierDetection: false });
    const expected = Array.from({ length: 8 }, () => pick(baseline).endpoint);
    const b = p2cBalancer({ outlierDetection: false });
    b.pick({ endpoints: ["a", "b"] })[1]?.done?.({ attempted: false });
    vi.setSystemTime(now - rollbackMs);
    b.pick({ endpoints: ["a", "b"] })[1]?.done?.({ attempted: false });
    vi.setSystemTime(now);
    const actual = Array.from({ length: 8 }, () => pick(b).endpoint);
    expect(expected).toEqual(["a", "b", "a", "b", "a", "b", "a", "b"]);
    expect(actual).toEqual(expected);
  },
);

test("non-finite RTT samples fall back to the configured initial estimate", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(-Number.MAX_VALUE);
  const b = p2cBalancer({ outlierDetection: false });
  const a = pick(b, ["a"]);
  clock.mockReturnValue(Number.MAX_VALUE);
  a.end?.({ attempted: true });
  a.done?.({ attempted: true });
  expect(pick(b).endpoint).toBe("a");
});

test("non-finite pending-weighted costs fall back to the finite initial estimate", () => {
  const b = p2cBalancer({
    defaultRttMs: Number.MAX_VALUE,
    outlierDetection: false,
  });
  pick(b, ["a"]);
  expect(pick(b).endpoint).toBe("a");
});

test.each([false, true])(
  "pruned unstarted picks rejoin the unique load state (replacement: %s)",
  (replacement) => {
    const b = p2cBalancer({ load: "pending", outlierDetection: false });
    const [, waiting] = pickEndpoint(b, { endpoints: ["a"] });
    expect(waiting).toBeDefined();
    const many = Array.from({ length: 257 }, (_, i) => `other-${i}`);
    b.pick({ endpoints: many })[1]?.done?.({ attempted: false });
    const current = replacement ? pick(b, ["a"]) : undefined;
    const competitor = replacement ? pick(b, ["b"]) : undefined;
    waiting?.start();
    const selected = pick(b);
    expect(selected.endpoint).toBe("b");
    selected.done?.({ attempted: false });
    waiting?.done({ attempted: false });
    waiting?.done({ attempted: false });
    current?.done?.({ attempted: false });
    competitor?.done?.({ attempted: false });
    expect(pick(b).endpoint).toBe("a");
  },
);

test("fast RTT samples recover after rollback without waiting for wall time to catch up", () => {
  function selections(rollback: boolean): (string | undefined)[] {
    vi.setSystemTime(10_000_000);
    const b = p2cBalancer({ outlierDetection: false });
    complete(b, "a", { attempted: true, sampleMs: 1000 });
    if (rollback) vi.setSystemTime(Date.now() - 3_600_000);
    for (let i = 0; i < 60; i += 1) {
      vi.advanceTimersByTime(1000);
      complete(b, "a", { attempted: true, sampleMs: 1 });
    }
    return Array.from(
      { length: 6 },
      () => b.pick({ endpoints: ["a", "b"] })[1]?.endpoint,
    );
  }
  const baseline = selections(false);
  expect(baseline).toEqual(["a", "a", "a", "a", "a", "a"]);
  expect(selections(true)).toEqual(baseline);
});

test("forward idle decay underflow preserves pending-load selection", () => {
  const b = p2cBalancer({ outlierDetection: false });
  b.pick({ endpoints: ["a", "b"] })[1]?.done?.({ attempted: false });
  vi.setSystemTime(8_000_000);
  const selected = Array.from({ length: 8 }, () => pick(b).endpoint);
  expect(selected).toEqual(["a", "b", "a", "b", "a", "b", "a", "b"]);
});
