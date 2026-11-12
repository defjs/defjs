# Revalidate with ETag and a 304 [#revalidate-with-etag-and-a-304]

In Defjs, only `2xx` responses take the success branch, so `304 Not Modified` arrives as an `HTTP_STATUS` fault. Leave `error` undeclared on `defineRequest` so the empty `304` body is never read, and keep your `Map` cache in an application wrapper around the operation call:

<Tabs items={["sdk/catalog.ts", "app/reader.ts", "app/main.ts"]}>
  <Tab>
```typescript
import { defineRequest, struct, type Infer } from "@defjs/core";

export const Product = struct.object({
  sku: struct.string(),
  name: struct.string(),
  priceCents: struct.number(),
});

export type Product = Infer<typeof Product>;

export const readProduct = defineRequest({
  method: "GET",
  path: "/catalog/:sku",
  input: struct.object({
    sku: struct.string(),
    etag: struct.string().optional(),
  }),
  builder: (input) => ({
    path: { sku: input.sku },
    headers: { "If-None-Match": input.etag },
  }),
  output: Product,
});
```

  </Tab>
  <Tab>
```typescript
import type { DerivableClient } from "@defjs/core";
import { readProduct, type Product } from "../sdk/catalog.ts";

export function createReader(client: DerivableClient) {
  const cache = new Map<string, { etag: string; product: Product }>();

  return async (sku: string): Promise<Product> => {
    const cached = cache.get(sku);
    const [error, product, response] = await readProduct(client, {
      sku,
      etag: cached?.etag,
    });

    if (error?.code === "HTTP_STATUS" && error.status === 304 && cached) {
      return cached.product;
    }
    // This reader returns Product, so a non-304 fault leaves here by throwing.
    if (error) throw error;

    const etag = response.headers.get("etag");
    if (!etag) throw new Error("missing ETag");
    cache.set(sku, { etag, product });
    return product;
  };
}
```

  </Tab>
  <Tab>
```typescript
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { createReader } from "./reader.ts";

const etag = '"v7"';
const client = createClient(
  withEndpoint("https://catalog.example.test"),
  // Stands in for the server: it answers 304 once the request carries the current ETag.
  withHTTPHandle((input, init) => {
    if (new Request(input, init).headers.get("if-none-match") === etag) {
      return Promise.resolve(
        new Response(null, { status: 304, headers: { etag } }),
      );
    }
    return Promise.resolve(
      Response.json(
        { sku: "SKU-1", name: "Flask", priceCents: 3200 },
        { status: 200, headers: { etag } },
      ),
    );
  }),
);

const read = createReader(client);
await read("SKU-1");
const product = await read("SKU-1");
console.log(product.name);
```

  </Tab>
</Tabs>

```txt
Flask
```

- The `if (error) throw error` after the `304` check is an explicit policy: `createReader` returns `Promise<Product>`, so every other fault is thrown.
- Never rewrite `304` into a synthetic `200` inside an interceptor; keep cache state in application code around the operation call. See [HTTP operations](/docs/http).
