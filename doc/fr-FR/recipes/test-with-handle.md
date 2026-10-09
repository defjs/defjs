---
title: Tester avec un handle Fetch local
description: Remplace Fetch pour un client avec withHTTPHandle et garde la commande inchangée.
---

# Tester avec un handle Fetch local

`withHTTPHandle(...)` remplace Fetch pour ce client seulement. Tu as toujours la construction d’URL, les intercepteurs, le dispatch par statut et le décodage Struct — sans DNS, TLS ni vrai serveur.

Voir [Client](../core/client.md) pour les détails.

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

Utilise la même commande `getUser` contre un vrai client `withEndpoint(...)` en production — seul le handle change.
