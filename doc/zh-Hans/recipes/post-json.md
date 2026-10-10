---
title: POST JSON
description: 把带类型的 JSON body 交给 builder，并解码声明过的 201。
---

# POST JSON

把带类型的 body 交给 builder。逻辑字段名留在 TypeScript；struct 上的线上 alias 会变成 JSON key。对象 body 是 `application/json`。

细节见 [Commands](../core/commands.md) 和 [HTTP](../core/http.md)。

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
