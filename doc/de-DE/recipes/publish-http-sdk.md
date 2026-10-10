---
title: Ein HTTP-SDK veröffentlichen, ohne execute zu verstecken
description: Exportiere Endpoints und createClient; Status-Narrowing bleibt am Call-Site.
---

# Ein HTTP-SDK veröffentlichen, ohne execute zu verstecken

Ein Method-SDK, das `client.execute` schluckt, kollabiert deklariertes `404` meist in einen untypisierten Throw oder einen gemeinsamen „API-Error“. Halte den Vertrag als Endpoints plus expliziten Client; Caller besitzen weiterhin das Status-Branching.

Siehe [Commands](../core/commands.md), [Client](../core/client.md) und [Entwurfsentscheidungen](../guide/design-decisions.md).

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

Exportiere Endpoints und eine Client-Factory. Helper dürfen `execute` für einen reviewed Pfad aufrufen, aber ersetze das Tupel nicht für jeden Status, der dich interessiert.
