---
title: الاختبار بـ Fetch محلي
description: استبدل Fetch لعميل واحد بـ withHTTPHandle واترك الأمر كما هو.
---

# الاختبار بـ Fetch محلي

`withHTTPHandle(...)` يستبدل Fetch لذلك العميل فقط. ما زلت تحصل على بناء URL والمعترضات وتوزيع الحالة وفك Struct — بلا DNS أو TLS أو خادم حقيقي.

انظر [العميل](../core/client.md) للتفاصيل.

```ts twoslash get-user.test.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const handle: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const id = new URL(request.url).pathname.split('/').at(-1)
  if (id === '7') return Response.json({ id: 7, name: 'Ada' }, { status: 200 })
  return Response.json({ message: 'User not found' }, { status: 404 })
}

const client = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(handle))
const [error, user, response] = await client.execute(getUser({ path: { id: 7 } }))

if (error) throw error
console.log(user.name, response.status)
```

```txt
Ada 200
```

استخدم نفس أمر `getUser` ضد عميل `withEndpoint(...)` حقيقي في الإنتاج — المعالج وحده يتغيّر.
