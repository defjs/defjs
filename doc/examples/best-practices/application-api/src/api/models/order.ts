// #region example
import { struct, type Infer } from "@defjs/core";

export const ApiError = struct.object({
  code: struct.string(),
  message: struct.string(),
  requestId: struct.string().optional().alias("request_id"),
});
export type ApiError = Infer<typeof ApiError>;

export const OrderStatus = struct.enum(["pending", "paid", "shipped"] as const);
export type OrderStatus = Infer<typeof OrderStatus>;

export const Order = struct.object({
  id: struct.number(),
  customerName: struct.string().alias("customer_name"),
  totalCents: struct.number().alias("total_cents"),
  status: OrderStatus,
});
export type Order = Infer<typeof Order>;

export const OrderPage = struct.object({
  items: struct.array(Order),
  nextCursor: struct.string().optional().alias("next_cursor"),
});
export type OrderPage = Infer<typeof OrderPage>;
// #endregion
