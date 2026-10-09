---
title: Publish 一個唔隱藏 execute 嘅 HTTP SDK
description: Export endpoints 同 createClient；status narrowing 留喺 call site。
---

# Publish 一個唔隱藏 execute 嘅 HTTP SDK

一個吞咗 `client.execute` 嘅 method SDK，通常會將 declared `404` 塌成 untyped throw，或者共用嘅「API error」。Contract 保持係 endpoints 加一個明確 client；callers 仍然 own status branching。

睇 [Commands](../core/commands.md)、[Client](../core/client.md) 同 [Design Decisions](../guide/design-decisions.md)。

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

Export endpoints 同一個 client factory。Helpers 可以為一條 reviewed path call `execute`，但唔好為每個你在意嘅 status 取代 tuple。
