// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, order] = await getOrder(client, { id: 1 });
  if (err) {
    console.error(err.code);
    return;
  }
  console.log(order.status);
}

void main();
// #endregion
