// #region example
import {
  createClient,
  defineRequest,
  ERR_NO_ENDPOINT,
  struct,
  withEndpoint,
  withEndpointBalancer,
} from "@defjs/core";
import type { EndpointBalancer } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const fixed: EndpointBalancer = {
  pick({ endpoints }) {
    const endpoint = endpoints[0];
    return endpoint === undefined
      ? [ERR_NO_ENDPOINT, undefined]
      : [
          null,
          {
            endpoint,
            start() {
              console.log("Transport started", endpoint);
            },
            end(info) {
              console.log("Transport responded", endpoint, info.status);
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
  withEndpointBalancer(fixed),
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
