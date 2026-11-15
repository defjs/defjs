// #region example
import {
  createHttpInterceptor,
  defineRequest,
  struct,
  type Client,
} from "@defjs/core";

export const submitOrder = defineRequest({
  method: "POST",
  meta: { operation: "orders.submit" },
  path: "/orders",
  input: struct.object({
    idempotencyKey: struct.string(),
    order: struct.object({
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    headers: { "idempotency-key": input.idempotencyKey },
    body: input.order,
  }),
  output: struct.object({
    id: struct.number(),
    customerName: struct.string().alias("customer_name"),
  }),
  error: struct.object({
    message: struct.string(),
  }),
});

export function bearerAuth(token: string) {
  return createHttpInterceptor((request, next) => {
    const headers = new Headers(request.headers);
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    return next({ ...request, headers });
  });
}

export async function checkoutOrder(
  client: Client,
  input: { customerName: string; idempotencyKey: string },
): Promise<
  [Error, undefined] | [null, { orderId: number; customerName: string }]
> {
  const [err, order] = await submitOrder(client, {
    idempotencyKey: input.idempotencyKey,
    order: { customerName: input.customerName },
  });
  if (err) {
    if (err.code === "HTTP_STATUS" && err.status === 409) {
      return [
        new Error(`duplicate order: ${err.data.message}`, { cause: err }),
        undefined,
      ];
    }
    return [new Error("submit order", { cause: err }), undefined];
  }
  return [null, { orderId: order.id, customerName: order.customerName }];
}
// #endregion
