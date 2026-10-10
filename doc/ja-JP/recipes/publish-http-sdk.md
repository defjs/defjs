---
title: execute を隠さずに HTTP SDK を公開する
description: エンドポイントと createClient を export し、status の絞り込みは呼び出し側に残します。
---

# execute を隠さずに HTTP SDK を公開する

`client.execute` を飲み込むメソッド SDK は、宣言済みの `404` を型の無い throw や、共有の「API エラー」に潰しがちです。契約はエンドポイントと明示的なクライアントのままにしてください。status の分岐は呼び出し側が所有したままです。

詳細は [Commands](../core/commands.md)、[Client](../core/client.md)、[設計上の判断](../guide/design-decisions.md) を見てください。

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

export するのはエンドポイントとクライアントファクトリです。ヘルパーはレビュー済みの 1 経路で `execute` を呼んでも構いませんが、気にするすべての status についてタプルを置き換えないでください。
