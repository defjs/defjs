// #region example
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { Pool } from "undici";
import { getOrder } from "../sdk/orders.ts";
import { createUndiciPoolHandle } from "./pool-handle.ts";

async function main() {
  const pool = new Pool("https://api.example.com", { connections: 32 });
  try {
    const client = createClient(
      withEndpoint("https://api.example.com"),
      withHTTPHandle(createUndiciPoolHandle(pool)),
    );
    const [err, order] = await getOrder(client, { id: "ord-1" });
    if (err) {
      console.error(err.code);
      return;
    }
    console.log(order.id, order.status);
  } finally {
    await pool.close();
  }
}

void main();
// #endregion
