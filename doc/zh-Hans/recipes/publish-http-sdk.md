---
title: 发布 HTTP SDK，别藏起 execute
description: 导出 endpoint 和 createClient；状态收窄留在调用点。
---

# 发布 HTTP SDK，别藏起 execute

把 `client.execute` 吞掉的方法式 SDK，通常会把声明过的 `404` 收成无类型的 throw，或一个共享的「API error」。契约保持为 endpoint 加显式 client；调用方仍拥有状态分支。

见 [Commands](../core/commands.md)、[Client](../core/client.md) 和[设计决策](../guide/design-decisions.md)。

```ts twoslash
// @filename: users-sdk.ts
import { createClient, defineRequest, struct, withEndpoint, type Client, type ClientOption } from '@defjs/core'

export const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  builder: (input) => ({ path: input.path }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

export function createUsersClient(...options: ClientOption[]): Client {
  return createClient(withEndpoint('https://api.example.com'), ...options)
}

export async function loadUserName(client: Client, id: number): Promise<string> {
  const [error, user] = await client.execute(getUser({ path: { id } }))
  if (error?.code === 'HTTP_STATUS' && error.status === 404) {
    throw new Error(error.data.message)
  }
  if (error) throw error
  return user.name
}
// @filename: app.ts
import { createUsersClient, getUser, loadUserName } from './users-sdk'
import { withHTTPHandle } from '@defjs/core'

const handle: typeof fetch = async () => Response.json({ id: 7, name: 'Ada' }, { status: 200 })

const client = createUsersClient(withHTTPHandle(handle))
const name = await loadUserName(client, 7)
const [error, user] = await client.execute(getUser({ path: { id: 7 } }))

console.log(name, error, user?.name)
```

```txt
Ada null Ada
```

导出 endpoint 和一个 client 工厂。Helper 可以为一条审过的路径调用 `execute`，但不要替你关心的每个状态替换掉 tuple。
