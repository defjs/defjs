// #region example
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import { getOrder } from "./orders-sdk.ts";

const handle: FetchHandle = async () =>
  Response.json({ id: 7, status: "paid" }, { status: 200 });

const client = createClient(
  withEndpoint("https://api.example.test"),
  withHTTPHandle(handle),
);
async function main() {
  const [error, order] = await getOrder(client, { id: 7 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
// #endregion
