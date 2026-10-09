---
title: 拆开 GraphQL HTTP 信封
description: GraphQL 保持 HTTP 200 加应用层拆包；Core 不带 GraphQL 协议。
---

# 拆开 GraphQL HTTP 信封

Defjs 不实现 GraphQL `errorPolicy`。把线上建模成一次 HTTP POST，builder 放上 query 文档和变量，再在你自己的 helper 里拆 `errors[]` / 缺失的 `data`。

见 [设计决策](../guide/design-decisions.md)。

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

HTTP 成功只说明信封到了。应用错误留在 `errors[]` 里，直到你的拆包函数抛出或返回。
