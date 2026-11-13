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

const plain = roundRobinBalancer();
const latencyAware = p2cBalancer({ choiceCount: 2, decayMs: 10000 });
// A custom strategy can use exactly the same filter.
const wrapped = outlierDetection(plain, { consecutiveFailures: 3 });
// #endregion

// #region ejection
const timedEjection = roundRobinBalancer({
  outlierDetection: {
    minPenaltyMs: 1000,
    maxPenaltyMs: 60000,
    jitterRatio: 0.5,
  },
});
// #endregion

// #region active
async function probe(endpoint: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(new URL("/healthz", endpoint), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function callWithHealthChecks() {
  const healthy = new Map<string, boolean>();
  const controller = new AbortController();
  let checking = false;
  async function check() {
    if (checking) return;
    checking = true;
    for (const endpoint of endpoints) {
      healthy.set(endpoint, await probe(endpoint, controller.signal));
    }
    checking = false;
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
  // The application owns the check lifecycle, not the client or balancer.
  const timer = setInterval(() => void check(), 5000);
  try {
    await check();
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
