import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { roundRobinBalancer } from "./balancer";

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
