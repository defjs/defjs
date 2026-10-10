---
title: 用 local Fetch handle 做 test
description: 用 withHTTPHandle 為一個 client 換走 Fetch，command 唔使改。
---

# 用 local Fetch handle 做 test

`withHTTPHandle(...)` 淨係換嗰個 client 嘅 Fetch。你仍然有 URL building、interceptors、status dispatch 同 Struct decoding — 唔使 DNS、TLS 或者真實 server。

詳情睇 [Client](../core/client.md)。

```ts twoslash get-user.test.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

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

Production 用同一個 `getUser` command 對住真實 `withEndpoint(...)` client — 淨係 handle 唔同。
