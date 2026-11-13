// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";
import { ApiError, Order, OrderPage, OrderStatus } from "../models/order.ts";

export const GetOrderInput = struct.object({
  id: struct.number(),
});
export type GetOrderInput = Infer<typeof GetOrderInput>;

export const getOrder = defineRequest({
  meta: { operation: "orders.get" },
  method: "GET",
  path: "/orders/:id",
  input: GetOrderInput,
  builder: (input) => ({
    path: { id: input.id },
  }),
  output: Order,
  error: ApiError,
});

export const ListOrdersInput = struct.object({
  status: OrderStatus.optional(),
  cursor: struct.string().optional(),
});
export type ListOrdersInput = Infer<typeof ListOrdersInput>;

export const listOrders = defineRequest({
  meta: { operation: "orders.list" },
  method: "GET",
  path: "/orders",
  input: ListOrdersInput,
  builder: (input) => ({
    query: {
      status: input.status,
      cursor: input.cursor,
    },
  }),
  output: OrderPage,
  error: ApiError,
});

export const CreateOrderInput = struct.object({
  customerName: struct.string(),
  totalCents: struct.number(),
  idempotencyKey: struct.string(),
});
export type CreateOrderInput = Infer<typeof CreateOrderInput>;

export const createOrder = defineRequest({
  meta: { operation: "orders.create" },
  method: "POST",
  path: "/orders",
  input: CreateOrderInput,
  builder: (input) => ({
    headers: { "idempotency-key": input.idempotencyKey },
    body: {
      customer_name: input.customerName,
      total_cents: input.totalCents,
    },
  }),
  output: Order,
  error: ApiError,
});
// #endregion
