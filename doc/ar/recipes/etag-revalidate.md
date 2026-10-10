---
title: أعد التحقق بـ ETag و304
description: عامل 304 كخطأ حالة HTTP؛ وأبقِ خريطة الذاكرة خارج execute.
---

# أعد التحقق بـ ETag و304

`ok` يعني 2xx، لذا يصل `304` كخطأ `HTTP_STATUS`. حالة إعادة التوجيه ليست جسم خطأ أيضًا، فاترك `error` غير معلَن: الجسم لا يُقرأ أبدًا، والخطأ يحمل الحالة، وأنت تُرجع المنتج المخزَّن بنفسك.

انظر [HTTP](../core/http.md).

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

لا تعِد كتابة `304` إلى `200` مزيف داخل Core. ملكية الذاكرة تبقى في كود التطبيق حول `execute`.
