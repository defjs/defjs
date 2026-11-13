// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getOrder } from "./define-request.ts";

const client = createClient(withEndpoint("https://api.example.com/v1"));

async function main() {
  const [err, order] = await getOrder(client, { id: 7 });
  if (err) {
    console.error(err.code);
    return;
  }
  console.log(order.status);
}

void main();
// #endregion
