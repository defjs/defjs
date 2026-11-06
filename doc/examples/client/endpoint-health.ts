import {
  createClient,
  defineRequest,
  outlierDetection,
  p2cBalancer,
  roundRobinBalancer,
  withEndpoint,
  withBalancer,
} from "@defjs/core";

const endpoints = ["https://api-a.example.com", "https://api-b.example.com"];
const getStatus = defineRequest({ method: "GET", path: "/status" });

// #region passive
const client = createClient(
  withEndpoint(...endpoints),
  withBalancer(
    roundRobinBalancer({
      outlierDetection: {
        consecutiveFailures: 5,
        minPenaltyMs: 1000,
        maxPenaltyMs: 60000,
        jitterRatio: 0.5,
      },
    }),
  ),
);

const unfiltered = roundRobinBalancer({ outlierDetection: false });
const latencyAware = p2cBalancer({ choiceCount: 2, decayMs: 10000 });
// A custom strategy can use exactly the same filter; disable any inner filter.
const wrapped = outlierDetection(unfiltered, { consecutiveFailures: 3 });
// #endregion

// #region recovery
const singleProbeRecovery = roundRobinBalancer({
  outlierDetection: {
    minPenaltyMs: 1000,
    maxPenaltyMs: 60000,
    jitterRatio: 0.5,
  },
});
// #endregion

// #region active
async function withHealthChecks() {
  const healthy = new Map<string, boolean>();
  const controller = new AbortController();
  let probing = false;
  async function probe() {
    if (probing) return;
    probing = true;
    try {
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(new URL("/healthz", endpoint), {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(2000),
            ]),
          });
          await response.body?.cancel();
          healthy.set(endpoint, response.ok);
        } catch {
          healthy.set(endpoint, false);
        }
      }
    } finally {
      probing = false;
    }
  }
  const activeClient = createClient(
    withEndpoint(...endpoints),
    withBalancer(
      roundRobinBalancer({
        outlierDetection: {
          consecutiveFailures: 0,
          isHealthy: (endpoint) => healthy.get(endpoint) ?? true,
        },
      }),
    ),
  );
  // The application owns the probe lifecycle, not the client or balancer.
  const timer = setInterval(() => {
    void probe().catch((cause: unknown) => {
      console.error("Health probe failed", cause);
    });
  }, 5000);
  try {
    await probe();
    const [error] = await getStatus(activeClient);
    if (error) {
      console.error(error.code);
      return;
    }
    console.log("Service responded");
  } finally {
    clearInterval(timer);
    controller.abort();
  }
}
// #endregion

async function main() {
  const [error] = await getStatus(client);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log("Service responded");
}

void main();
