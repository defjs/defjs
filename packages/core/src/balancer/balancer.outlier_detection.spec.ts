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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
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
  vi.setSystemTime(30000);
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
  "%s contains rejected synchronous extension results without unhandledRejection",
  async (entry) => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const invalidPick: Balancer = {
        // @ts-expect-error rejected promises violate the synchronous pick contract
        pick: () => Promise.reject(new Error("invalid async pick")),
      };
      const child: Balancer = {
        pick: ({ endpoints }) => [null, { endpoint: endpoints[0] ?? "" }],
      };
      const balancers = {
        direct: invalidPick,
        wrapped: outlierDetection(invalidPick),
        isHealthy: outlierDetection(child, {
          // @ts-expect-error rejected promises violate the synchronous health contract
          isHealthy: () => Promise.reject(new Error("invalid async health")),
        }),
        isFailure: outlierDetection(child, {
          consecutiveFailures: 1,
          // @ts-expect-error rejected promises violate the synchronous classifier contract
          isFailure: () =>
            Promise.reject(new Error("invalid async classifier")),
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
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener("unhandledRejection", unhandled);
    }
  },
);
