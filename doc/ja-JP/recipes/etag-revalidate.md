---
title: ETag と 304 で再検証する
description: 304 は HTTP status の fault として扱い、キャッシュの Map は execute の外に置きます。
---

# ETag と 304 で再検証する

`ok` は 2xx を意味するので、`304` は `HTTP_STATUS` の fault として届きます。リダイレクト status もエラーボディではないので、`error` は宣言しないでください。ボディは読まれず、fault が status を運び、キャッシュした商品は自分で返します。

詳細は [HTTP](../core/http.md) を見てください。

```ts twoslash etag-cache.ts
import { createClient, defineRequest, struct, type Infer, withEndpoint, withHTTPHandle } from '@defjs/core'

const Product = struct.object({
  sku: struct.string(),
  name: struct.string(),
  priceCents: struct.number(),
})

type Product = Infer<typeof Product>

const readProduct = defineRequest({
  method: 'GET',
  path: '/catalog/:sku',
  input: struct.object({
    path: struct.object({ sku: struct.string() }),
    headers: struct.object({
      etag: struct.string().optional().alias('If-None-Match'),
    }),
  }),
  builder: (input) => ({ path: input.path, headers: input.headers }),
  output: Product,
})

function createReader(client: ReturnType<typeof createClient>) {
  const cache = new Map<string, { etag: string; product: Product }>()

  return async (sku: string): Promise<Product> => {
    const cached = cache.get(sku)
    const [error, product, response] = await client.execute(readProduct({ path: { sku }, headers: { etag: cached?.etag } }))

    if (error?.code === 'HTTP_STATUS' && error.status === 304 && cached) {
      return cached.product
    }
    if (error) throw error

    const etag = response.headers.get('etag')
    if (!etag) throw new Error('missing ETag')
    cache.set(sku, { etag, product })
    return product
  }
}

const etag = '"v7"'
const handle: typeof fetch = async (input, init) => {
  if (new Request(input, init).headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } })
  }
  return Response.json({ sku: 'SKU-1', name: 'Flask', priceCents: 3200 }, { status: 200, headers: { etag } })
}

const client = createClient(withEndpoint('https://catalog.example.test'), withHTTPHandle(handle))
const read = createReader(client)
await read('SKU-1')
const product = await read('SKU-1')
console.log(product.name)
```

```txt
Flask
```

Core の中で `304` を偽の `200` に書き換えないでください。キャッシュの所有は、`execute` の周りのアプリケーションコードに残します。
