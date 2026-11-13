// #region example
import { struct } from "@defjs/core";
import { Order } from "../sdk/schema.ts";

const [error, order] = struct.parse(Order, {
  id: 1,
  status: "paid",
  customerName: "Ada",
});

if (error) {
  console.error(error.message);
} else {
  console.log(order.customerName);
}
// #endregion
