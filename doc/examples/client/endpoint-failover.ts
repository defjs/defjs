// #region example
import {
  createClient,
  defineRequest,
  pickFirstBalancer,
  struct,
  withEndpoint,
  withEndpointBalancer,
  withEndpointFailover,
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
  withEndpointBalancer(pickFirstBalancer({ failbackMs: 30_000 })),
  withEndpointFailover({
    attempts: 1,
    retryOn: ["connect-failure", "gateway-error", "attempt-timeout"],
    attemptTimeoutMs: 2_000,
    retryBudget: {
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
