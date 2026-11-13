// #region example
import { defineRequest, struct, type Client } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

async function loadOrderStatus(
  client: Client,
): Promise<[Error, undefined] | [null, string]> {
  const [err, order] = await getOrder(client, { id: 7 });
  if (err) {
    return [err, undefined];
  }
  return [null, order.status];
}
// #endregion
