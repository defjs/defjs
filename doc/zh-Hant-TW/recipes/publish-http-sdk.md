---
title: 發布 HTTP SDK，且不要藏起 execute
description: 匯出 endpoints 與 createClient；狀態窄化留在呼叫端。
---

# 發布 HTTP SDK，且不要藏起 execute

把 `client.execute` 吞掉的 method SDK，通常會把已宣告的 `404` 塌成沒有型別的 throw，或共用的「API error」。契約保持為 endpoints 加上明確的 client；呼叫端仍擁有依狀態分支。

見 [Commands](../core/commands.md)、[Client](../core/client.md)、[設計決策](../guide/design-decisions.md)。

```ts twoslash
// @filename: users-sdk.ts
import { createClient, defineRequest, struct, withEndpoint, type Client, type ClientOption } from '@defjs/core'

export const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
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

匯出 endpoints 與 client factory。Helper 可以為一條審過的路徑呼叫 `execute`，但不要替你在意的每個狀態取代 tuple。
