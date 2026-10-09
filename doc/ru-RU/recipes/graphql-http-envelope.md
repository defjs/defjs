---
title: Разверни GraphQL HTTP envelope
description: GraphQL остаётся HTTP 200 плюс прикладной unwrap; у Core нет протокола GraphQL.
---

# Разверни GraphQL HTTP envelope

Defjs не реализует GraphQL `errorPolicy`. Моделируй wire как HTTP POST, чей builder кладёт query document и variables, а `errors[]` / отсутствующий `data` разворачивай в своём helper’е.

См. [Проектные решения](../guide/design-decisions.md).

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

HTTP-успех значит только то, что envelope доехал. Прикладные ошибки остаются в `errors[]`, пока твой unwrap не бросит или не вернёт.
