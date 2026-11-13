// #region example
import { defineEventStream, struct } from "@defjs/core";

export const watchOrders = defineEventStream({
  path: "/orders/events",
  meta: { operation: "orders.watch" },
  events: {
    updated: struct.object({
      id: struct.number(),
      status: struct.string(),
    }),
  },
});
// #endregion
