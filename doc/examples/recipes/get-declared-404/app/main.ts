// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, order, response] = await getOrder(client, { id: 7 });
  if (error?.code === "HTTP_STATUS" && error.status === 404) {
    console.log(error.data.message);
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(`Loaded ${order.status} from ${response.status}`);
}

void main();
// #endregion
