---
title: Déballer une enveloppe GraphQL HTTP
description: Garde GraphQL en HTTP 200 plus un déballage applicatif ; Core ne livre pas de protocole GraphQL.
---

# Déballer une enveloppe GraphQL HTTP

Defjs n’implémente pas de `errorPolicy` GraphQL. Modélise le wire comme un POST HTTP dont le builder place le document de query et les variables, puis déballe `errors[]` / un `data` manquant dans ton propre helper.

Voir [Décisions de conception](../guide/design-decisions.md).

```ts twoslash graphql-viewer.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle, type Client } from '@defjs/core'

const VIEWER_QUERY = 'query Viewer { viewer { id login } }' as const

const runViewer = defineRequest({
  method: 'POST',
  path: '/graphql',
  builder: () => ({
    body: { query: VIEWER_QUERY, operationName: 'Viewer' },
  }),
  output: struct.object({
    data: struct
      .object({
        viewer: struct.object({ id: struct.string(), login: struct.string() }).null(),
      })
      .optional(),
    errors: struct.array(struct.object({ message: struct.string() })).optional(),
  }),
})

async function loadViewer(client: Client) {
  const [error, result] = await client.execute(runViewer())
  if (error) throw error
  if (result.errors?.length) {
    throw new Error(result.errors.map((item) => item.message).join('; '))
  }
  if (!result.data) throw new Error('GraphQL response contained neither data nor errors')
  return result.data.viewer
}

let calls = 0
const handle: typeof fetch = async () => {
  calls += 1
  const body = calls === 1 ? { data: { viewer: { id: 'v-1', login: 'ada' } } } : { errors: [{ message: 'viewer unavailable' }] }
  return Response.json(body, { status: 200 })
}

const client = createClient(withEndpoint('https://api.example.test'), withHTTPHandle(handle))
const viewer = await loadViewer(client)
let graphQlError = ''
try {
  await loadViewer(client)
} catch (error) {
  graphQlError = error instanceof Error ? error.message : String(error)
}
console.log(viewer?.login, graphQlError)
```

```txt
ada viewer unavailable
```

Un succès HTTP veut seulement dire que l’enveloppe est arrivée. Les erreurs applicatives restent dans `errors[]` jusqu’à ce que ton déballage throw ou renvoie.
