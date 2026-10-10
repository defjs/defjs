---
title: 宣言済み 404 付きの GET
description: GET を 1 回実行し、型付き 200 と宣言済み 404 で分岐します。
---

# 宣言済み 404 付きの GET

成功と 404 のボディの両方を宣言します。`error.code` と `error.status` で分岐すると、宣言済みの miss に対して型付きの `error.data` が得られます。

詳細は [HTTP](../core/http.md) と [Errors](../core/errors.md) を見てください。

```ts twoslash get-user.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  builder: (input) => ({ path: input.path }),
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

2xx 以外の status はすべて `HTTP_STATUS` です。`error` を宣言すればそのボディに型が付き、`error` を省けば `err.data` は `undefined` のまま、ボディは読まれません。ひとつの `error` Struct が 2xx 以外のすべての status を受け持つので、形が異なるときは `struct.or(...)` か判別可能な union を使ってください。
