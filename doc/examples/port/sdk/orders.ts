// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
});
export type Order = Infer<typeof Order>;

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: Order,
});
// #endregion
