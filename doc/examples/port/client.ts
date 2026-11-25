// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { withPortTransport } from "@defjs/core/port";
import { getOrder } from "./sdk/orders.ts";

export async function fetchOrderOverPort(port: MessagePort, id: number) {
  const client = createClient(
    withEndpoint("https://api.example.com"),
    withPortTransport(port),
  );
  const [err, order] = await getOrder(client, { id });
  if (err) {
    return [err, undefined] as const;
  }
  return [null, order] as const;
}
// #endregion
