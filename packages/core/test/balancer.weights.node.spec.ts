import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { roundRobinBalancer } from "../src";

test("accepts a Map created in another realm", () => {
  const foreign: unknown = runInNewContext("new Map([['a', 3], ['b', 1]])");
  expect(foreign).not.toBeInstanceOf(Map);
  // @ts-expect-error the value comes from another realm and is untyped here
  const balancer = roundRobinBalancer({ weights: foreign });
  const picks = Array.from({ length: 4 }, () => {
    const [error, result] = balancer.pick({ endpoints: ["a", "b"] });
    if (error !== null) throw error;
    return result.endpoint;
  });
  expect(picks.filter((endpoint) => endpoint === "a")).toHaveLength(3);
});
