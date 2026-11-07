// #region example
import { defineRequest, struct } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

export const ApiError = struct.object({
  code: struct.string(),
  message: struct.string(),
});

export const NewOrder = struct.object({
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

export const createOrder = defineRequest({
  method: "POST",
  path: "/orders",
  input: NewOrder,
  builder: (input) => ({ body: input }),
  output: Order,
  error: ApiError,
});
// #endregion
