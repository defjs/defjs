---
title: 用本地 Fetch handle 做测试
description: 用 withHTTPHandle 只换这一个 Client 的 Fetch，command 保持不变。
---

# 用本地 Fetch handle 做测试

`withHTTPHandle(...)` 只替换该 Client 的 Fetch。URL 拼装、interceptor、状态分派、Struct 解码都还在——不用 DNS、TLS、真服务。

细节见 [Client](../core/client.md)。

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

生产里用同一个 `getUser` command 对着真实 `withEndpoint(...)` Client——变的只是 handle。
