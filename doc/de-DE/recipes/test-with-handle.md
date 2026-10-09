---
title: Mit lokalem Fetch-Handle testen
description: Fetch für einen Client mit withHTTPHandle tauschen und den Command unverändert lassen.
---

# Mit lokalem Fetch-Handle testen

`withHTTPHandle(...)` ersetzt Fetch nur für diesen Client. Du bekommst weiterhin URL-Building, Interceptors, Status-Dispatch und Struct-Decoding — ohne DNS, TLS oder echten Server.

Details siehe [Client](../core/client.md).

```ts twoslash get-user.test.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
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

Nutze denselben `getUser`-Command gegen einen echten `withEndpoint(...)`-Client in Production — nur das Handle ändert sich.
