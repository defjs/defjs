# POST JSON [#post-json]

Pass a typed input object to `builder` and return `{ body: input }`. `.alias("customer_name")` keeps `customerName` in TypeScript while encoding `"customer_name"` on the wire and decoding it back from the `201` response.

<Tabs items={["sdk/orders.ts", "app/main.ts"]}>
  <Tab>
```typescript
import { defineRequest, struct } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

export const ApiError = struct.object({
  code: struct.string(),
  message: struct.string(),
});

export const NewOrder = struct.object({
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

export const createOrder = defineRequest({
  method: "POST",
  path: "/orders",
  input: NewOrder,
  builder: (input) => ({ body: input }),
  output: Order,
  error: ApiError,
});
```

  </Tab>
  <Tab>
```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { createOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com/v1"));

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
```

  </Tab>
</Tabs>

With a server that responds with `201` and `{ "id": 1, "status": "paid", "customer_name": "Ada" }`, the script prints:

```txt
Created paid → 201
```

See [HTTP operations](/docs/http) and [Struct & schemas](/docs/struct) for details.
