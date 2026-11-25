// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { listAllOrders } from "./paginate.ts";

const client = createClient(withEndpoint("https://api.example.com/v1"));

async function main() {
  const controller = new AbortController();
  for await (const [err, order] of listAllOrders(client, {
    limit: 50,
    signal: controller.signal,
  })) {
    if (err) {
      console.error(err.code);
      return;
    }
    console.log(order.id, order.totalCents);
  }
}

void main();
// #endregion
