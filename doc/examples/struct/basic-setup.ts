// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";

const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
  totalCents: struct.number().alias("total_cents"),
});

type Order = Infer<typeof Order>;

const createOrder = defineRequest({
  method: "POST",
  path: "/orders",
  input: struct.object({
    status: struct.string(),
    customerName: struct.string().alias("customer_name"),
  }),
  builder: (input) => ({ body: input }),
  output: Order,
});

function readOrder() {
  const [parseError, order] = struct.parse(Order, {
    id: 7,
    status: "paid",
    totalCents: 4200,
  });
  if (parseError) {
    console.error(parseError.message);
    return;
  }
  console.log(order.status);
}

readOrder();
void createOrder;
// #endregion
