---
title: Опубликуй HTTP SDK, не пряча execute
description: Экспортируй эндпоинты и createClient; сужение по status оставь на call site.
---

# Опубликуй HTTP SDK, не пряча execute

Method-SDK, который глотает `client.execute`, обычно схлопывает объявленный `404` в нетипизированный throw или общий «API error». Держи контракт как эндпоинты плюс явный клиент; ветвление по status по-прежнему на вызывающем.

См. [Команды](../core/commands.md), [Клиент](../core/client.md) и [Проектные решения](../guide/design-decisions.md).

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

Экспортируй эндпоинты и фабрику клиента. Helper может звать `execute` для одного проверенного пути, но не подменяй кортеж для каждого status, который тебе важен.
