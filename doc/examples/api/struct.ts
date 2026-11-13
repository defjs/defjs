// #region example
import { struct } from "@defjs/core";

const Order = struct.object({
  id: struct.number(),
  customerName: struct.string().alias("customer_name"),
});

function readOrder() {
  const [err, order] = struct.parse(Order, { id: 1, customerName: "Ada" });
  if (err) {
    console.error(err.message);
    return;
  }
  console.log(order.customerName);
}

readOrder();
// #endregion
