# Test with a local Fetch handle [#test-with-a-local-fetch-handle]

`withHTTPHandle(...)` replaces the underlying `fetch` function for a single client while exercising the entire Defjs pipeline—input validation, `builder` mapping, URL resolution, interceptors, status classification, and Struct decoding—without opening a network socket:

<Tabs items={["sdk/orders.ts", "test/orders.spec.ts"]}>
  <Tab>
```typescript
import { defineRequest, struct } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
});

export const NotFound = struct.object({
  message: struct.string(),
});

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: Order,
  error: NotFound,
});
```

  </Tab>
  <Tab>
```typescript
import { expect, test } from "vitest";
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle((input, init) => {
    const request = new Request(input, init);
    expect(request.method).toBe("GET");
    if (new URL(request.url).pathname === "/orders/7") {
      return Promise.resolve(Response.json({ id: 7, status: "paid" }));
    }
    return Promise.resolve(
      Response.json({ message: "Order not found" }, { status: 404 }),
    );
  }),
);

test("getOrder decodes the successful response", async () => {
  const [error, order, response] = await getOrder(client, { id: 7 });
  expect(error).toBeNull();
  if (error) throw error;
  expect(order).toEqual({ id: 7, status: "paid" });
  expect(response.status).toBe(200);
});

test("getOrder decodes the declared error response", async () => {
  const [error, order, response] = await getOrder(client, { id: 8 });
  expect(order).toBeUndefined();
  expect(response).toBeUndefined();
  expect(error?.code).toBe("HTTP_STATUS");
  if (error?.code !== "HTTP_STATUS") throw new Error("Expected HTTP_STATUS");
  expect(error.status).toBe(404);
  expect(error.data).toEqual({ message: "Order not found" });
  expect(error.response.status).toBe(404);
});
```

  </Tab>
</Tabs>

In production, call the exact same `getOrder` operation with a client configured with `withEndpoint(...)`. See [Testing](/docs/testing) and [Client](/docs/client).
