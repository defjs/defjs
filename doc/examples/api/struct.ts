// #region example
import { struct } from "@defjs/core";

const Order = struct.object({
  id: struct.number(),
  customerName: struct.string().alias("customer_name"),
});

function readOrder() {
  const [error, order] = struct.parse(Order, { id: 1, customerName: "Ada" });
  if (error) {
    console.error(error.message);
    return;
  }
  console.log(order.customerName);
}

readOrder();
// #endregion
