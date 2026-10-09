---
title: GraphQL HTTP envelope 풀기
description: GraphQL은 HTTP 200과 애플리케이션 unwrap로 두고, Core는 GraphQL 프로토콜을 제공하지 않아요.
---

# GraphQL HTTP envelope 풀기

Defjs는 GraphQL `errorPolicy`를 구현하지 않아요. 와이어는 builder가 query 문서와 변수를 배치하는 HTTP POST로 두고, `errors[]`와 빠진 `data`는 직접 만든 헬퍼에서 푸세요.

[설계 결정](../guide/design-decisions.md)을 보세요.

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

HTTP 성공은 envelope가 도착했다는 뜻일 뿐이에요. 애플리케이션 오류는 unwrap이 throw하거나 돌려줄 때까지 `errors[]`에 남아요.
