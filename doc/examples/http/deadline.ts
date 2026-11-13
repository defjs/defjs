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

async function main() {
  const [err, order] = await getOrder(
    client({ signal: AbortSignal.timeout(5_000) }),
    { id: 1 },
  );
  if (err) {
    if (err.code === "NET_TIMEOUT") {
      console.error("timed out");
      return;
    }
    console.error(err.code);
    return;
  }
  console.log(order.status);
}

void main();
// #endregion
