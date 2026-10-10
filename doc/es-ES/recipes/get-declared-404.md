---
title: GET con un 404 declarado
description: Ejecuta un GET y ramifica entre 200 tipado y 404 declarado.
---

# GET con un 404 declarado

Declara tanto el cuerpo de éxito como el de 404. Ramifica con `error.code` y `error.status` — obtienes `error.data` tipado para el miss declarado.

Ver detalles en [HTTP](../core/http.md) y [Errores](../core/errors.md).

```ts twoslash get-user.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))

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

const [error, user, response] = await client.execute(getUser({ path: { id: 7 } }))

if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (error) {
  console.error(error.code)
} else {
  console.log(`Loaded ${user.name} from ${response.status}`)
}
```

```txt
Loaded Ada from 200
```

Todo estado no-2xx es `HTTP_STATUS`. Declarar `error` le da un tipo a su cuerpo; omitir `error` deja `err.data` en `undefined` y el cuerpo sin leer. Un único Struct `error` cubre todos los estados no-2xx, así que usa `struct.or(...)` o una unión discriminada cuando las formas difieran.
