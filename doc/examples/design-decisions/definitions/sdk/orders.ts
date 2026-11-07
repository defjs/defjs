// #region example
import { defineRequest, struct } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
});

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: Order,
});
// #endregion
