// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com/v1"));
const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({
    path: { id: input.id },
    query: { fields: input.fields },
  }),
});

// → https://api.example.com/v1/orders/a%2Fb?fields=status

async function main() {
  const [error] = await getOrder(client, { id: "a/b", fields: "status" });
  if (error) {
    console.error(error.code);
    return;
  }
}

void main();
// #endregion
