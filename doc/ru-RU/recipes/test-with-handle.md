---
title: Тест с локальным Fetch handle
description: Подмени Fetch для одного клиента через withHTTPHandle — команда та же.
---

# Тест с локальным Fetch handle

`withHTTPHandle(...)` заменяет Fetch только для этого клиента. Ты всё равно получаешь сборку URL, interceptors, status dispatch и Struct-decode — без DNS, TLS и настоящего сервера.

Подробности — в [Клиент](../core/client.md).

```ts twoslash get-user.test.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  builder: (input) => ({ path: input.path }),
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

Ту же команду `getUser` гоняй против реального клиента с `withEndpoint(...)` в проде — меняется только handle.
