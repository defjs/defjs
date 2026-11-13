// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, order, response] = await getOrder(client, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status, response.status);
}

void main();
// #endregion
