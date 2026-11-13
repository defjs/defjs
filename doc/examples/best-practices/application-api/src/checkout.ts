// #region example
import { apiClient } from "./api/client.ts";
import { createOrder, getOrder, listOrders } from "./api/services/orders.ts";

export async function placeAndLoadOrder() {
  const [createErr, created] = await createOrder(
    apiClient({ signal: AbortSignal.timeout(5_000) }),
    {
      customerName: "Ada Lovelace",
      totalCents: 4200,
      idempotencyKey: "idem-2026-101",
    },
  );
  if (createErr) {
    if (createErr.code === "HTTP_STATUS") {
      console.error(createErr.data.code, createErr.data.message);
    }
    return undefined;
  }

  const [getErr, order] = await getOrder(apiClient, { id: created.id });
  if (getErr) return undefined;

  const [listErr, page] = await listOrders(apiClient, { status: "paid" });
  if (listErr) return undefined;

  return {
    id: order.id,
    status: order.status,
    totalOrders: page.items.length,
  };
}
// #endregion
