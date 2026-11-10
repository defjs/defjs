import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Balancer } from "./balancer";
import { roundRobinBalancer } from "./balancer";
import {
  createClient,
  defineRequest,
  withBalancer,
  withEndpoint,
  withHTTPHandle,
} from "../index";
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

test("default round robin returns done and ejects a rolling-restart replica until expiry", () => {
  const balancer = roundRobinBalancer();
  for (let failure = 0; failure < 5; failure += 1) {
    const [, picked] = balancer.pick({
      endpoints: ["a", "b", "c"],
    });
    expect(picked?.done).toBeTypeOf("function");
    picked?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
    for (let healthy = 0; healthy < 2; healthy += 1) {
      balancer
        .pick({ endpoints: ["a", "b", "c"] })[1]
        ?.done?.({ attempted: true, status: 200 });
    }
  }
  const choices = Array.from(
    { length: 6 },
    () => balancer.pick({ endpoints: ["a", "b", "c"] })[1]?.endpoint,
  );
  expect(choices).not.toContain("a");
  expect(new Set(choices)).toEqual(new Set(["b", "c"]));
  vi.advanceTimersByTime(30000 - performance.now());
  expect(
    Array.from(
      { length: 3 },
      () => balancer.pick({ endpoints: ["a", "b", "c"] })[1]?.endpoint,
    ),
  ).toContain("a");
});

test.each(["NET_UNREACHABLE", "NET_UNAVAILABLE", "NET_SERVER_ERROR"] as const)(
  "outlier detection counts neutral %s without a status",
  (code) => {
    const balancer = roundRobinBalancer({
      outlierDetection: { consecutiveFailures: 1 },
    });
    balancer.pick({ endpoints: ["a", "b"] })[1]?.done?.({
      attempted: true,
      code,
    });
    expect(
      Array.from(
        { length: 4 },
        () => balancer.pick({ endpoints: ["a", "b"] })[1]?.endpoint,
      ),
    ).toEqual(["b", "b", "b", "b"]);
  },
);
test("outlier detection ignores a raw 503 without a neutral outcome", () => {
  const balancer = roundRobinBalancer({
    outlierDetection: { consecutiveFailures: 1 },
  });
  balancer.pick({ endpoints: ["a", "b"] })[1]?.done?.({
    attempted: true,
    status: 503,
  });
  expect(
    Array.from(
      { length: 4 },
      () => balancer.pick({ endpoints: ["a", "b"] })[1]?.endpoint,
    ),
  ).toEqual(["b", "a", "b", "a"]);
});

test.each(["direct", "wrapped", "isHealthy", "isFailure"] as const)(
  "%s attaches a rejection handler to rejected synchronous extension results",
  async (entry) => {
    const observed: [unknown, string][] = [];
    function rejectedThenable(msg: string): {
      then(fulfilled: unknown, rejected: (reason: unknown) => void): void;
    } {
      return {
        then(fulfilled, rejected) {
          observed.push([fulfilled, typeof rejected]);
          rejected(new Error(msg));
        },
      };
    }
    const invalidPick: Balancer = {
      // @ts-expect-error rejected promises violate the synchronous pick contract
      pick: () => rejectedThenable("invalid async pick"),
    };
    const child: Balancer = {
      pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }],
    };
    const balancers = {
      direct: invalidPick,
      wrapped: outlierDetection(invalidPick),
      isHealthy: outlierDetection(child, {
        // @ts-expect-error rejected promises violate the synchronous health contract
        isHealthy: () => rejectedThenable("invalid async health"),
      }),
      isFailure: outlierDetection(child, {
        consecutiveFailures: 1,
        // @ts-expect-error rejected promises violate the synchronous classifier contract
        isFailure: () => rejectedThenable("invalid async classifier"),
      }),
    };
    const client = createClient(
      withEndpoint("https://a.test", "https://b.test"),
      withBalancer(balancers[entry]),
      withHTTPHandle(() => Promise.resolve(new Response(null))),
    );
    const operation = defineRequest({ method: "GET", path: "/" });
    const [fault] = await operation(client);
    expect(fault?.code ?? null).toBe(
      entry === "isFailure"
        ? null
        : entry === "isHealthy"
          ? "REQ_OPTIONS_INVALID"
          : "REQ_BUILD_FAILED",
    );
    expect(observed.length).toBeGreaterThanOrEqual(1);
    expect(
      observed.every(
        ([fulfilled, kind]) => fulfilled === undefined && kind === "function",
      ),
    ).toBe(true);
  },
);

test("forwards start, end and done to the child result without a receiver", () => {
  const start = vi.fn();
  const end = vi.fn();
  const done = vi.fn();
  const [error, selected] = pickEndpoint(
    outlierDetection({
      pick: () => [null, { endpoint: "a", start, end, done }],
    }),
    { endpoints: ["a", "b"] },
  );
  expect(error).toBeNull();
  selected?.start();
  selected?.end({ attempted: true, status: 200 });
  selected?.done({ attempted: true, status: 200 });
  for (const callback of [start, end, done]) {
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.contexts[0]).toBeUndefined();
  }
});
