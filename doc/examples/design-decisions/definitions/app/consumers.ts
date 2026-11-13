// #region example
import type { Client } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

async function loadOrderStatus(
  client: Client,
): Promise<[Error, undefined] | [null, string]> {
  const [err, order] = await getOrder(client, { id: 7 });
  if (err) {
    return [err, undefined];
  }
  return [null, order.status];
}
// #endregion
