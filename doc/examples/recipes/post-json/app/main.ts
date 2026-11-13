// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { createOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com/v1"));

async function main() {
  const [error, order, response] = await createOrder(client, {
    status: "paid",
    customerName: "Ada",
  });
  if (error?.code === "HTTP_STATUS") {
    console.error(error.status, error.data.message);
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(`Created ${order.status} → ${response.status}`);
}

void main();
// #endregion
