// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, order, response] = await getOrder(client, { id: 1 });
  if (err) {
    console.error(err.code);
    return;
  }
  console.log(order.status, response.status);
}

void main();
// #endregion
