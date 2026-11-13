// #region example
import {
  createClient,
  defineRequest,
  ERR_NO_CANDIDATE,
  struct,
  withEndpoint,
  withBalancer,
} from "@defjs/core";
import type { Balancer } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const fixed: Balancer = {
  pick({ endpoints }) {
    const endpoint = endpoints[0];
    if (endpoint === undefined) return [ERR_NO_CANDIDATE, undefined];
    return [
      null,
      {
        endpoint,
        start() {
          console.log("Attempt started", endpoint);
        },
        end(info) {
          console.log("Peer responded", endpoint, info.code);
        },
        done(info) {
          console.log("Attempt finished", endpoint, info.attempted);
        },
      },
    ];
  },
};

const client = createClient(
  withEndpoint("https://api-us.example.com", "https://api-eu.example.com"),
  withBalancer(fixed),
);

async function main() {
  const [error, order] = await getOrder(client, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
// #endregion
