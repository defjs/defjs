// #region example
import {
  createClient,
  defineRequest,
  pickFirstBalancer,
  struct,
  withEndpoint,
  withBalancer,
  withRetry,
} from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
const client = createClient(
  withEndpoint("https://api-us.example.com", "https://api-eu.example.com"),
  withBalancer(pickFirstBalancer({ failbackMs: 30_000 })),
  withRetry({
    maxAttempts: 3,
    on: ["connect-failure", "gateway-error", "attempt-timeout"],
    attemptTimeoutMs: 2_000,
    delayMs: 25,
    maxDelayMs: 250,
    budget: {
      percentCanRetry: 0.2,
      minRetriesPerSecond: 10,
      ttlMs: 10_000,
    },
  }),
);
async function main() {
  const [error, order] = await getOrder(
    client({ signal: AbortSignal.timeout(5_000) }),
    { id: 1 },
  );
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}
void main();
// #endregion
