// #region example
import type { Client } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

async function loadOrder(client: Client) {
  const [error, order] = await getOrder(client, { id: 7 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}
// #endregion
