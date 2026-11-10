import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  defineEventStream,
  defineWebSocket,
  struct,
  withBalancer,
  withEndpoint,
} from "../index";
import {
  pickFirstBalancer,
  roundRobinBalancer,
  type Balancer,
  type PickResult,
} from "./balancer";
import { p2cBalancer } from "./p2c";
import { outlierDetection } from "./outlier_detection";
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
function pick(balancer: Balancer, endpoints = ["a", "b"]): PickResult {
  const [error, result] = balancer.pick({ endpoints });
  if (error) throw error;
  return result;
}
const failed = { attempted: true, code: "NET_UNREACHABLE" } as const;

function smoothSelections(a: number, b: number): string[] {
  const weights = new Map([
    ["a", a],
    ["b", b],
  ]);
  const balancer = roundRobinBalancer({ weights, outlierDetection: false });
  return Array.from({ length: 40 }, () => pick(balancer).endpoint);
}

test.each([
  [Number.MAX_VALUE, Number.MAX_VALUE],
  [Number.MIN_VALUE, Number.MIN_VALUE],
])("smooth weighted picks alternate for equal weights %j", (a, b) => {
  expect(smoothSelections(a, b)).toEqual(
    Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "a" : "b")),
  );
});

// Out of 40 picks, b is selected 40 * b / (a + b) times; a ratio below floating-point precision rounds to zero.
test.each([
  [Number.MAX_VALUE, Number.MIN_VALUE, 0],
  [1e-200, 3e-200, 30],
  [1e200, 3e200, 30],
])(
  "smooth weighted picks stay proportional for %j and %j",
  (a, b, expected) => {
    const selected = smoothSelections(a, b);
    expect(
      selected.every((endpoint) => endpoint === "a" || endpoint === "b"),
    ).toBe(true);
    expect(selected.filter((endpoint) => endpoint === "b")).toHaveLength(
      expected,
    );
  },
);

test("weighted round robin selects from the candidate set when the list is large", () => {
  const endpoints = Array.from({ length: 2000 }, (_, i) => `peer-${i}`);
  const balancer = roundRobinBalancer({
    weights: new Map(),
    outlierDetection: false,
  });
  for (let i = 0; i < 3; i++)
    expect(endpoints).toContain(pick(balancer, endpoints).endpoint);
});

test.each([false, true])(
  "failed failback probes give backup a turn before reprobe (lifecycle %s)",
  (lifecycle) => {
    const balancer = pickFirstBalancer({ failbackMs: 35 });
    pick(balancer).done?.(failed);
    expect(pick(balancer).endpoint).toBe("b");
    const selected: string[] = [];
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(45);
      const attempt = lifecycle
        ? pickEndpoint(balancer, { endpoints: ["a", "b"] })[1]
        : pick(balancer);
      if (attempt === undefined) throw new Error("missing lifecycle selection");
      selected.push(attempt.endpoint);
      if (lifecycle) {
        attempt.start?.();
        attempt.end?.(failed);
      }
      attempt.done?.(attempt.endpoint === "a" ? failed : { attempted: true });
    }
    expect(selected).toEqual(["a", "b", "a", "b"]);
  },
);

test.each([86_400_000, -3_600_000])(
  "wall clock jump %i cannot expire a penalty or failback interval",
  (jump) => {
    const balancer = outlierDetection(
      { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
      { consecutiveFailures: 1, minPenaltyMs: 100, jitterRatio: 0 },
    );
    pick(balancer).done?.(failed);
    vi.setSystemTime(jump);
    expect(pick(balancer).endpoint).toBe("b");
    vi.advanceTimersByTime(100);
    expect(pick(balancer).endpoint).toBe("a");
    const sticky = pickFirstBalancer({ failbackMs: 100 });
    pick(sticky).done?.(failed);
    vi.setSystemTime(jump * 2);
    expect(pick(sticky).endpoint).toBe("b");
    vi.advanceTimersByTime(100);
    expect(pick(sticky).endpoint).toBe("a");
  },
);

test.each([86_400_000, -3_600_000])(
  "wall clock jump %i does not poison in-flight RTT",
  (jump) => {
    function selections(wallJump: number) {
      const balancer = p2cBalancer({
        defaultRttMs: 1,
        decayMs: 10000,
        outlierDetection: false,
      });
      const a = pick(balancer, ["a"]);
      a.start?.();
      vi.advanceTimersByTime(10);
      vi.setSystemTime(Date.now() + wallJump);
      a.end?.({ attempted: true });
      a.done?.({ attempted: true });
      const b = pick(balancer, ["b"]);
      b.start?.();
      vi.advanceTimersByTime(100);
      b.end?.({ attempted: true });
      b.done?.({ attempted: true });
      return Array.from({ length: 10 }, () => pick(balancer).endpoint);
    }
    expect(selections(jump)).toEqual(selections(0));
  },
);

test("custom balancers cannot select outside their candidate set, and the rejected pick is released", () => {
  const done = vi.fn();
  const [fault, result] = pickEndpoint(
    { pick: () => [null, { endpoint: "https://private.invalid", done }] },
    { endpoints: ["a"] },
  );
  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(fault?.cause).toEqual(
    new Error("Balancer selected an endpoint outside the candidate set"),
  );
  expect(result).toBeUndefined();
  expect(done).toHaveBeenCalledExactlyOnceWith({ attempted: false });
});

test.each(["HTTP", "SSE", "WS"])(
  "%s contains unprintable thrown causes and foreign endpoints",
  async (transport) => {
    const cause: unknown = Object.create(null);
    for (const balancer of [
      {
        pick() {
          throw cause;
        },
      },
      {
        pick: () => [null, { endpoint: "https://private.invalid" }],
      } satisfies Balancer,
    ]) {
      const client = createClient(
        withEndpoint("https://a.test"),
        withBalancer(balancer),
      );
      const call =
        transport === "HTTP"
          ? () => defineRequest({ method: "GET", path: "/" })(client)
          : transport === "SSE"
            ? () => defineEventStream({ path: "/", events: {} })(client)
            : () =>
                defineWebSocket({
                  path: "/",
                  incoming: struct.unknown(),
                })(client);
      const [fault] = await call();
      expect(fault?.code).toBe("REQ_BUILD_FAILED");
      if (fault && fault.cause === cause)
        expect(fault.message).toBe("Unknown error");
    }
  },
);

test("health callbacks cannot claim the same half-open probe reentrantly", () => {
  let nested: PickResult | undefined;
  let reenter = false;
  const balancer: Balancer = outlierDetection(
    { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
    {
      consecutiveFailures: 1,
      minPenaltyMs: 100,
      jitterRatio: 0,
      isHealthy() {
        if (reenter) {
          reenter = false;
          nested = pick(balancer);
        }
        return true;
      },
    },
  );
  pick(balancer).done?.(failed);
  vi.advanceTimersByTime(100);
  reenter = true;
  const outer = pick(balancer);
  expect(nested?.endpoint).toBe("a");
  expect(outer.endpoint).toBe("b");
  expect(pick(balancer).endpoint).toBe("b");
});

test("unattributed samples neither reset consecutive failures nor add failures", () => {
  const balancer = outlierDetection(
    { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
    { consecutiveFailures: 2, jitterRatio: 0 },
  );
  pick(balancer).done?.({ attempted: false, code: "NET_UNREACHABLE" });
  pick(balancer).done?.(failed);
  expect(pick(balancer).endpoint).toBe("a");
  pick(balancer).done?.({ attempted: false });
  pick(balancer).done?.(failed);
  expect(pick(balancer).endpoint).toBe("b");
});

test("shuffle keeps a key for 256 recent endpoints and re-draws a forgotten one", () => {
  const random = vi.mocked(Math.random);
  const balancer = pickFirstBalancer({ shuffle: true });
  random.mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);
  expect(pick(balancer, ["a", "b"]).endpoint).toBe("b");
  for (let i = 0; i < 254; i++) pick(balancer, [`near-${i}`]);
  expect(pick(balancer, ["a", "b"]).endpoint).toBe("b");
  for (let i = 0; i < 300; i++) pick(balancer, [`far-${i}`]);
  random.mockReturnValueOnce(0.05).mockReturnValueOnce(0.95);
  expect(pick(balancer, ["a", "b"]).endpoint).toBe("a");
});

test("churn and per-call exclusions preserve penalised endpoints and in-flight probes", () => {
  const balancer = outlierDetection(
    { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
    {
      consecutiveFailures: 1,
      minPenaltyMs: 100,
      jitterRatio: 0,
    },
  );
  pick(balancer).done?.(failed);
  for (let i = 0; i < 1000; i++)
    pick(balancer, [`clean-${i}`]).done?.({ attempted: true });
  expect(pick(balancer).endpoint).toBe("b");
  vi.advanceTimersByTime(100);
  const probe = pick(balancer);
  expect(probe.endpoint).toBe("a");
  for (let i = 0; i < 1000; i++)
    pick(balancer, [`clean-after-${i}`]).done?.({ attempted: true });
  expect(pick(balancer).endpoint).toBe("b");
  probe.done?.(failed);
  expect(pick(balancer).endpoint).toBe("b");
});

test("weighted candidate changes rescale safely and sparse candidates select nothing", () => {
  const balancer = roundRobinBalancer({
    weights: new Map([
      ["a", Number.MAX_VALUE],
      ["b", Number.MIN_VALUE],
    ]),
    outlierDetection: false,
  });
  pick(balancer, ["a", "b"]);
  expect(pick(balancer, ["b"]).endpoint).toBe("b");
  expect(balancer.pick({ endpoints: new Array<string>(1) })[0]).toBeInstanceOf(
    Error,
  );
});

test("hard cap falls back to oldest protected states only when no idle history remains", () => {
  const balancer = outlierDetection(
    { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
    { consecutiveFailures: 1, jitterRatio: 0 },
  );
  for (let i = 0; i < 300; i++) pick(balancer, [`broken-${i}`]).done?.(failed);
  expect(pick(balancer, ["broken-0", "fresh"]).endpoint).toBe("broken-0");
  expect(pick(balancer, ["broken-299", "fresh"]).endpoint).toBe("fresh");
});

test("health still attributes selected peers when a candidate list exceeds its history cap", () => {
  const endpoints = Array.from({ length: 300 }, (_, i) => `large-${i}`);
  const balancer = outlierDetection(
    {
      pick: ({ endpoints: candidates }) => [
        null,
        { endpoint: candidates[0] ?? "" },
      ],
    },
    { consecutiveFailures: 1, jitterRatio: 0 },
  );
  pick(balancer, endpoints).done?.(failed);
  expect(pick(balancer, endpoints).endpoint).toBe("large-1");
});

test("health evicts clean history before a more recent partial failure sequence", () => {
  const balancer = outlierDetection(
    { pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }] },
    { consecutiveFailures: 2, jitterRatio: 0 },
  );
  pick(balancer, ["partial"]).done?.(failed);
  for (let i = 0; i < 256; i++)
    pick(balancer, [`clean-${i}`]).done?.({ attempted: true });
  pick(balancer, ["partial"]).done?.(failed);
  expect(pick(balancer, ["partial", "fresh"]).endpoint).toBe("fresh");
});

test.each([
  { lifecycle: false, picks: 2 },
  { lifecycle: false, picks: 3 },
  { lifecycle: true, picks: 2 },
  { lifecycle: true, picks: 3 },
])(
  "first primary failure gives backup a turn within $picks picks (lifecycle $lifecycle)",
  ({ lifecycle, picks }) => {
    const balancer = pickFirstBalancer({
      failbackMs: 35,
      outlierDetection: false,
    });
    const selected: string[] = [];
    for (let i = 0; i < picks; i++) {
      const attempt = lifecycle
        ? pickEndpoint(balancer, { endpoints: ["a", "b"] })[1]
        : pick(balancer);
      if (attempt === undefined) throw new Error("missing lifecycle selection");
      selected.push(attempt.endpoint);
      const report = attempt.endpoint === "a" ? failed : { attempted: true };
      if (lifecycle) {
        attempt.start?.();
        attempt.end?.(report);
      }
      attempt.done?.(report);
      vi.advanceTimersByTime(45);
    }
    expect(selected).toEqual(picks === 2 ? ["a", "b"] : ["a", "b", "a"]);
  },
);
