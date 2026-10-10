---
title: POST JSON
description: 타입이 있는 JSON body를 보내고 선언된 201을 디코딩해요.
---

# POST JSON

타입이 있는 body를 builder에 넘겨요. 논리 필드 이름은 TypeScript에 두고, struct의 와이어 alias가 JSON 키가 돼요. 객체 body는 `application/json`이에요.

자세한 내용은 [명령](../core/commands.md)과 [HTTP](../core/http.md)를 보세요.

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
