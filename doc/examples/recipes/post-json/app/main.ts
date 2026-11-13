// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { createOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com/v1"));

async function main() {
  const [err, order, response] = await createOrder(client, {
    status: "paid",
    customerName: "Ada",
  });
  if (err) {
    if (err.code === "HTTP_STATUS") {
      console.error(err.status, err.data.message);
      return;
    }
    console.error(err.code);
    return;
  }
  console.log(`Created ${order.status} → ${response.status}`);
}

void main();
// #endregion
