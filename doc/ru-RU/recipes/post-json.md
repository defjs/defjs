---
title: POST JSON
description: Отправь типизированное JSON-тело и декодируй объявленный 201.
---

# POST JSON

Отдай типизированное тело builder’у. Логические имена полей остаются в TypeScript; wire-алиасы на struct становятся JSON-ключами. Тело-объект — это `application/json`.

Подробности — в [Команды](../core/commands.md) и [HTTP](../core/http.md).

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
