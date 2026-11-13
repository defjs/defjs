// #region example
import { struct } from "@defjs/core";
import { Order } from "../sdk/schema.ts";

function main() {
  const [err, order] = struct.parse(Order, {
    id: 1,
    status: "paid",
    customerName: "Ada",
  });
  if (err) {
    console.error(err.message);
    return;
  }
  console.log(order.customerName);
}

main();
// #endregion
