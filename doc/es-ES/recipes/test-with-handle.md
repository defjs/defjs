---
title: Probar con un handle Fetch local
description: Sustituye Fetch en un cliente con withHTTPHandle y deja el comando igual.
---

# Probar con un handle Fetch local

`withHTTPHandle(...)` reemplaza Fetch solo para ese cliente. Sigues teniendo construcción de URL, interceptores, despacho por estado y decodificación Struct — sin DNS, TLS ni servidor real.

Ver detalles en [Cliente](../core/client.md).

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

Usa el mismo comando `getUser` contra un cliente real con `withEndpoint(...)` en producción — solo cambia el handle.
