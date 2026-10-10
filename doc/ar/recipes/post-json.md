---
title: POST JSON
description: أرسل جسم JSON مُنوَّعًا وفكّ 201 معلَنًا.
---

# POST JSON

سلّم الجسم المُنوَّع إلى الـ builder. أسماء الحقول المنطقية تبقى في TypeScript؛ وأسماء السلك المستعارة على الـ struct تصبح مفاتيح JSON. جسم الكائن هو `application/json`.

انظر [الأوامر](../core/commands.md) و[HTTP](../core/http.md) للتفاصيل.

```ts twoslash create-user.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  email: struct.string(),
})

const ApiError = struct.object({
  code: struct.string(),
  message: struct.string(),
})

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({
    body: struct.object({
      name: struct.string(),
      email: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.body }),
  output: User,
  error: ApiError,
})

const [error, user, response] = await client.execute(createUser({ body: { name: 'Ada', email: 'ada@example.com' } }))

if (error?.code === 'HTTP_STATUS') {
  console.error(error.status, error.data.message)
} else if (error) {
  console.error(error.code)
} else {
  console.log(`Created ${user.name} → ${response.status}`)
}
```

```txt
Created Ada → 201
```
