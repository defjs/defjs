// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com/v1"));

const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

const ApiError = struct.object({
  code: struct.string(),
  message: struct.string(),
});

const NewOrder = struct.object({
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

const createOrder = defineRequest({
  method: "POST",
  path: "/orders",
  input: NewOrder,
  builder: (input) => ({ body: input }),
  output: Order,
  error: ApiError,
});

async function main() {
  const [error, order, response] = await createOrder(client, {
    status: "paid",
    customerName: "Ada",
  });
  if (error?.code === "HTTP_STATUS") {
    console.error(error.status, error.data.message);
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(`Created ${order.status} → ${response.status}`);
}

void main();
// #endregion
