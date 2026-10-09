---
title: ローカル Fetch ハンドルでテストする
description: withHTTPHandle で 1 クライアント分の Fetch を差し替え、コマンドはそのままにします。
---

# ローカル Fetch ハンドルでテストする

`withHTTPHandle(...)` はそのクライアントだけ Fetch を差し替えます。URL 組み立て、インターセプター、status 振り分け、Struct デコードはそのまま — DNS・TLS・実サーバーは不要です。

詳細は [Client](../core/client.md) を見てください。

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

本番では同じ `getUser` コマンドを、本物の `withEndpoint(...)` クライアントに対して使います — 変わるのはハンドルだけです。
