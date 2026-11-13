// #region example
import { struct } from "@defjs/core";

const Order = struct.object({
  customerName: struct.string().alias("customer_name"),
});

function readDisplayName() {
  const [err, order] = struct.parse(Order, { customerName: "Ada" });
  if (err) {
    console.error(err.message);
    return;
  }
  console.log(order.customerName);
}

readDisplayName();

const [wireErr] = struct.parse(Order, { customer_name: "Ada" });
// Expected failure: public parse reads logical keys, not wire keys.
if (wireErr) {
  console.log(wireErr.issues[0]?.path);
}
// #endregion
