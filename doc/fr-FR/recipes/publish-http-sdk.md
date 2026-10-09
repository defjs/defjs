---
title: Publier un SDK HTTP sans cacher execute
description: Exporte des endpoints et createClient ; garde le rétrécissement de statut au site d’appel.
---

# Publier un SDK HTTP sans cacher execute

Un SDK de méthodes qui avale `client.execute` rabaisse en général un `404` déclaré en throw non typé ou en « erreur API » partagée. Garde le contrat comme des endpoints plus un client explicite ; les appelants possèdent encore le branchement sur le statut.

Voir [Commandes](../core/commands.md), [Client](../core/client.md) et [Décisions de conception](../guide/design-decisions.md).

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

Exporte des endpoints et une factory de client. Les helpers peuvent appeler `execute` pour un chemin revu, mais ne remplacent pas le tuple pour chaque statut qui t’importe.
