import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  EndpointBalancer,
  EndpointDoneInfo,
  EndpointTransport,
} from "./balancer";
import { ERR_NO_ENDPOINT } from "./balancer";
import { p2cBalancer } from "./p2c";
import { pickEndpoint } from "./runtime";

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
  balancer: EndpointBalancer,
  endpoints = ["a", "b"],
  transport: EndpointTransport = "http",
) {
  const [error, result] = balancer.pick({ endpoints, transport });
  expect(error).toBeNull();
  if (result === undefined) throw new Error("missing pick");
  expect(result.done).toBeTypeOf("function");
  result.start?.();
  return result;
}
function complete(
  balancer: EndpointBalancer,
  endpoint: string,
  report: EndpointDoneInfo & { sampleMs?: number },
  transport: EndpointTransport = "http",
) {
  const result = pick(balancer, [endpoint], transport);
  vi.setSystemTime(Date.now() + (report.sampleMs ?? 0));
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
    vi.setSystemTime(Date.now() + 100);
    result.end?.({ attempted: true, status: 200 });
    result.done?.({ attempted: true, status: 200 });
    vi.setSystemTime((i + 1) * 1000);
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
  vi.setSystemTime(50);
  const other = pick(b, ["b"]);
  vi.setSystemTime(200);
  a.end?.({ attempted: true });
  other.end?.({ attempted: true });
  expect(pick(b).endpoint).toBe("b");
  vi.setSystemTime(300);
  const smaller = pick(b, ["a"]);
  vi.setSystemTime(301);
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
    complete(b, "a", { attempted: true, status: 503 });
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
    const b = p2cBalancer(options as never);
    const first = b.pick({ endpoints: ["a"], transport: "http" })[0];
    expect(first).toBeInstanceOf(Error);
    expect(b.pick({ endpoints: [], transport: "http" })[0]).toBe(first);
    expect(
      pickEndpoint(b, { endpoints: ["a"], transport: "http" })[0]?.code,
    ).toBe("REQ_OPTIONS_INVALID");
  }
  expect(p2cBalancer().pick({ endpoints: [], transport: "http" })[0]).toBe(
    ERR_NO_ENDPOINT,
  );
});

test("state pruning forgets idle absent hosts but retains outstanding picks", () => {
  const b = p2cBalancer({ outlierDetection: false, choiceCount: 10 });
  complete(b, "old", { attempted: true, sampleMs: 2000 });
  const held = pick(b, ["held"]);
  vi.setSystemTime(Date.now() + 3000);
  held.end?.({ attempted: true });
  held.done?.({ attempted: true });
  const outstanding = pick(b, ["held"]);
  const many = Array.from({ length: 257 }, (_, i) => `new${i}`);
  pick(b, many).done?.({ attempted: false });
  expect(pick(b, ["old", "fresh"]).endpoint).toBe("old");
  expect(pick(b, ["held", "fresh2"]).endpoint).toBe("fresh2");
  outstanding.done?.({ attempted: false });
});

test("sparse runtime candidate arrays cannot produce an undefined endpoint", () => {
  const b = p2cBalancer({ outlierDetection: false });
  const empty = new Array<string>(1);
  expect(b.pick({ endpoints: empty, transport: "http" })[0]).toBe(
    ERR_NO_ENDPOINT,
  );
  const sparse = new Array<string>(2);
  sparse[1] = "a";
  expect(pick(b, sparse).endpoint).toBe("a");
});
