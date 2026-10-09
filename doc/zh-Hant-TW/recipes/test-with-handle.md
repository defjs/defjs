---
title: 用本機 Fetch handle 測試
description: 用 withHTTPHandle 替換單一 client 的 Fetch，command 維持不變。
---

# 用本機 Fetch handle 測試

`withHTTPHandle(...)` 只替換該 client 的 Fetch。你仍會拿到 URL 建立、interceptors、狀態碼分派與 Struct 解碼 — 不需要 DNS、TLS 或真實伺服器。

細節見 [Client](../core/client.md)。

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

正式環境用真實的 `withEndpoint(...)` client 跑同一個 `getUser` command — 變的只有 handle。
