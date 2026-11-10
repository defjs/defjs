import { test } from "vitest";
import { roundRobinBalancer } from "./balancer";

const endpoints = Array.from({ length: 2000 }, (_, i) => `peer-${i}`);
const members = [...endpoints, "extra"];
let sink: unknown;

// Measures a weighted round-robin pick over a large candidate list. It has no
// threshold: compare the latency with a previous run when touching the pick path.
test("weighted round robin pick over 2000 candidates", async ({ bench }) => {
  const balancer = roundRobinBalancer({
    weights: new Map(),
    outlierDetection: false,
  });
  const result = await bench("pick", () => {
    sink = balancer.pick({ endpoints, members });
  }).run({ iterations: 10, time: 500, warmupIterations: 1, warmupTime: 100 });
  if (result.latency.samplesCount === 0) {
    throw new Error("no samples were collected");
  }
  if (sink === undefined) throw new Error("pick was not called");
});
