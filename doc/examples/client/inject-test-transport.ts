// #region example
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const client = createClient(
  withEndpoint("https://fixture.invalid"),
  // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: preserve async rejection behavior for construction errors instead of introducing synchronous throws
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
async function main() {
  const [error, order] = await getOrder(client, { id: 7 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
// #endregion
