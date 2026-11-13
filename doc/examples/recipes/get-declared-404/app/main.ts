// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, order, response] = await getOrder(client, { id: 7 });
  if (err) {
    if (err.code === "HTTP_STATUS" && err.status === 404) {
      console.log(err.data.message);
      return;
    }
    console.error(err.code);
    return;
  }
  console.log(`Loaded ${order.status} from ${response.status}`);
}

void main();
// #endregion
