// #region example
import { defineRequest, struct } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
});

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: Order,
});
// #endregion
