---
title: انشر SDK لـ HTTP دون إخفاء execute
description: صدّر نقاط النهاية وcreateClient؛ وأبقِ تضييق الحالة عند موقع الاستدعاء.
---

# انشر SDK لـ HTTP دون إخفاء execute

SDK من الطرائق يبتلع `client.execute` عادةً يطوي `404` المعلَن في رمي غير مُنوَّع أو «خطأ API» مشترك. أبقِ العقد كنقاط نهاية مع عميل صريح؛ وما زال المستدعون يملكون التفرّع على الحالة.

انظر [الأوامر](../core/commands.md) و[العميل](../core/client.md) و[قرارات التصميم](../guide/design-decisions.md).

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

صدّر نقاط النهاية ومصنع عميل. يجوز للمساعدات أن تستدعي `execute` لمسار واحد مراجع، لكن لا تستبدل الـ tuple لكل حالة تهمّك.
