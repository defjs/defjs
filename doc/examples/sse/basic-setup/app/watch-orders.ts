// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { watchOrders } from "../sdk/orders-stream.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, stream] = await watchOrders(client);
  if (err) {
    console.error(err.code);
    return;
  }

  await using active = stream;
  for await (const event of active) {
    if (event.event !== "updated") continue;
    console.log(event.data.id, event.data.status);
    break;
  }
}

void main();
// #endregion
