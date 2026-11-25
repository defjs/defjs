// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";

export const ChargeInput = struct.object({
  orderId: struct.string().alias("order_id"),
  amountCents: struct.number().alias("amount_cents"),
});
export type ChargeInput = Infer<typeof ChargeInput>;

export const Charge = struct.object({
  id: struct.string(),
  status: struct.enum(["succeeded", "pending"]),
});
export type Charge = Infer<typeof Charge>;

export const createCharge = defineRequest({
  method: "POST",
  path: "/charges",
  input: ChargeInput,
  builder: (input) => ({ body: input }),
  output: Charge,
});
// #endregion
