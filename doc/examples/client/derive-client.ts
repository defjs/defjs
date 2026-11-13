// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

async function main(signal: AbortSignal) {
  const requestClient = client({
    signal,
    onDownloadProgress(event) {
      console.log(event.loaded);
    },
  });
  const [err, order] = await getOrder(requestClient, { id: 1 });
  if (err) {
    console.error(err.code);
    return;
  }
  console.log(order.status);
}
// #endregion
