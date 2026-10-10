---
title: POST JSON
description: 型付きの JSON ボディを送り、宣言済みの 201 をデコードします。
---

# POST JSON

型付きのボディをビルダーに渡します。論理フィールド名は TypeScript 側に残り、struct 上のワイヤエイリアスが JSON のキーになります。オブジェクトのボディは `application/json` です。

詳細は [Commands](../core/commands.md) と [HTTP](../core/http.md) を見てください。

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
