// #region example
import { apiClient } from "./api/client.ts";
import type { OrderStatus } from "./api/schema/order.ts";
import { createOrder, getOrder, listOrders } from "./api/request/orders.ts";

type Checkout = { id: number; status: OrderStatus; totalOrders: number };

export async function placeAndLoadOrder(): Promise<
  [Error, undefined] | [null, Checkout]
> {
  const [createErr, created] = await createOrder(
    apiClient({ signal: AbortSignal.timeout(5_000) }),
    {
      customerName: "Ada Lovelace",
      totalCents: 4200,
      idempotencyKey: "idem-2026-101",
    },
  );
  if (createErr) {
    return [new Error("create order", { cause: createErr }), undefined];
  }

  const [getErr, order] = await getOrder(apiClient, { id: created.id });
  if (getErr) {
    return [new Error("get order", { cause: getErr }), undefined];
  }

  const [listErr, page] = await listOrders(apiClient, { status: "paid" });
  if (listErr) {
    return [new Error("list orders", { cause: listErr }), undefined];
  }

  return [
    null,
    { id: order.id, status: order.status, totalOrders: page.items.length },
  ];
}
// #endregion
