// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";

export const Order = struct.object({
  id: struct.string(),
  totalCents: struct.number().alias("total_cents"),
});
export type Order = Infer<typeof Order>;

export const OrderPage = struct.object({
  items: struct.array(Order),
  nextCursor: struct.string().optional().alias("next_cursor"),
});

export const listOrders = defineRequest({
  method: "GET",
  path: "/orders",
  input: struct.object({
    cursor: struct.string().optional(),
    limit: struct.number().optional(),
  }),
  builder: (input) => ({
    query: {
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    },
  }),
  output: OrderPage,
});
// #endregion
