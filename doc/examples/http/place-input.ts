// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
  output: struct.object({
    id: struct.number(),
    customerName: struct.string().alias("customer_name"),
  }),
});

async function main() {
  const [err, order] = await updateOrder(client, {
    id: 7,
    requestId: "request-42",
    profile: { customerName: "Ada" },
  });
  if (err) {
    console.error(err.code);
    return;
  }
  console.log(order.id);
}

void main();
// #endregion
