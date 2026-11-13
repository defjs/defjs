// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

async function main() {
  const [err, order, response] = await getOrder(client, { id: 7 });
  if (err) {
    if (err.code === "HTTP_STATUS" && err.status === 404) {
      console.log(err.data.message);
      return;
    }
    if (err.code === "NET_TIMEOUT") {
      console.log("timed out");
      return;
    }
    if (err.code === "RES_STRUCT_MISMATCH") {
      console.log(
        "the response did not match what we declared",
        err.response.status,
      );
      return;
    }
    console.error(err.code);
    return;
  }
  console.log(order.status, response.status);
}

void main();
// #endregion
