// #region example
import { struct } from "@defjs/core";

const Order = struct.object({
  customerName: struct.string().alias("customer_name"),
});

function readDisplayName() {
  const [parseError, order] = struct.parse(Order, { customerName: "Ada" });
  if (parseError) {
    console.error(parseError.message);
    return;
  }
  console.log(order.customerName);
}

readDisplayName();

const [wireError] = struct.parse(Order, { customer_name: "Ada" });
// Expected failure: public parse reads logical keys, not wire keys.
if (!wireError) throw new Error("struct.parse must read logical keys");
console.log(wireError.issues[0]?.path);
// #endregion
