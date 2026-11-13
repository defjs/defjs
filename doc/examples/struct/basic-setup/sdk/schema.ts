// #region example
import { struct, type Infer } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.enum(["pending", "paid", "shipped"] as const),
  customerName: struct.string().alias("customer_name"),
  notes: struct.string().optional(),
});

export type Order = Infer<typeof Order>;
// #endregion
