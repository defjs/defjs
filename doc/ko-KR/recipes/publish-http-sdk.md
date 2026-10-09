---
title: execute를 숨기지 않고 HTTP SDK 공개하기
description: 엔드포인트와 createClient를 export하고, status 좁히기는 호출 지점에 두세요.
---

# execute를 숨기지 않고 HTTP SDK 공개하기

`client.execute`를 삼키는 method SDK는 선언된 `404`를 타입이 없는 throw나 공유 “API 오류”로 눌러 버려요. 계약은 엔드포인트와 명시적인 클라이언트로 두고, status 분기는 호출자가 소유하게 하세요.

[명령](../core/commands.md), [클라이언트](../core/client.md), [설계 결정](../guide/design-decisions.md)을 보세요.

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

엔드포인트와 클라이언트 팩토리를 export하세요. 헬퍼는 검토된 경로 하나에서 `execute`를 호출해도 되지만, 신경 쓰는 모든 status의 튜플을 대체하지는 마세요.
