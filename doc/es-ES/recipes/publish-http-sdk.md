---
title: Publicar un SDK HTTP sin ocultar execute
description: Exporta endpoints y createClient; deja el estrechamiento de estado en el call site.
---

# Publicar un SDK HTTP sin ocultar execute

Un SDK de métodos que se traga `client.execute` suele colapsar un `404` declarado en un throw sin tipo o en un «error de API» compartido. Mantén el contrato como endpoints más un cliente explícito; quien llama sigue siendo dueño de la ramificación por estado.

Ver [Comandos](../core/commands.md), [Cliente](../core/client.md) y [Decisiones de diseño](../guide/design-decisions.md).

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

Exporta endpoints y una factory de cliente. Los helpers pueden llamar a `execute` para un camino revisado, pero no sustituyen la tupla para cada estado que te importe.
