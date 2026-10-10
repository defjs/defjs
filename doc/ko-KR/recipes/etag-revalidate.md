---
title: ETag와 304로 재검증하기
description: 304는 HTTP status fault로 두고, 캐시 Map은 execute 밖에 둬요.
---

# ETag와 304로 재검증하기

`ok`는 2xx를 뜻해서 `304`는 `HTTP_STATUS` fault로 도착해요. 리다이렉트 status도 오류 body가 아니니 `error`는 선언하지 않은 채로 두세요. body는 읽히지 않고, fault가 status를 가져요. 캐시된 상품은 직접 돌려주세요.

[HTTP](../core/http.md)를 보세요.

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

Core 안에서 `304`를 가짜 `200`으로 다시 쓰지 마세요. 캐시 소유권은 `execute` 주변의 애플리케이션 코드에 남아요.
