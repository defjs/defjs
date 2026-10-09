---
title: GET مع 404 معلَن
description: نفّذ GET واحدًا وفرّع على 200 مُنوَّع مقابل 404 معلَن.
---

# GET مع 404 معلَن

أعلن أجسام النجاح و404 معًا. فرّع على `error.code` و`error.status` — تحصل على `error.data` مُنوَّعًا للفقدان المعلَن.

انظر [HTTP](../core/http.md) و[الأخطاء](../core/errors.md) للتفاصيل.

```ts twoslash get-user.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [error, user, response] = await client.execute(getUser({ path: { id: 7 } }))

if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (error) {
  console.error(error.code)
} else {
  console.log(`Loaded ${user.name} from ${response.status}`)
}
```

```txt
Loaded Ada from 200
```

كل حالة غير-2xx هي `HTTP_STATUS`. وإعلان `error` يمنح جسمه نوعًا؛ وحذفه يترك `err.data` بقيمة `undefined` والجسم غير مقروء. و`error` واحد يغطي كل الحالات غير-2xx، فاستخدم `struct.or(...)` أو اتحادًا مُميَّزًا عندما تختلف الأشكال.
