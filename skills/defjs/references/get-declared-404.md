# GET with a declared 404 [#get-with-a-declared-404]

Declare both `output` (for 2xx responses) and `error` (for non-2xx responses) on `defineRequest`. At the call site, branch on `error?.code === "HTTP_STATUS" && error.status === 404` to read the typed `error.data` payload.

<Tabs items={["sdk/orders.ts", "app/main.ts"]}>
  <Tab>
```typescript
import { defineRequest, struct } from "@defjs/core";

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: struct.object({ message: struct.string() }),
});
```

  </Tab>
  <Tab>
```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, order, response] = await getOrder(client, { id: 7 });
  if (error?.code === "HTTP_STATUS" && error.status === 404) {
    console.log(error.data.message);
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(`Loaded ${order.status} from ${response.status}`);
}

void main();
```

  </Tab>
</Tabs>

With a server that answers `GET /orders/7` with `200` and `{ "id": 7, "status": "paid" }`, the script prints:

```txt
Loaded paid from 200
```

- Every non-2xx status produces `HTTP_STATUS`. Declaring `error` decodes and validates the error body into `error.data`; omitting `error` leaves `error.data` as `undefined` without reading the body.
- If a declared `error` body has the wrong media type, invalid JSON, or fails Struct validation, the operation returns a `RES_*` fault instead. Because a single `error` Struct covers all non-2xx statuses, use `struct.or(...)` when different error statuses return different shapes.

See [HTTP operations](/docs/http) and [Error handling](/docs/errors).
