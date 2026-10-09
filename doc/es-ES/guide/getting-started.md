---
title: 'Primeros pasos: una solicitud HTTP'
description: Define GET /users/:id, ejecútalo contra un handle Fetch local y luego apúntalo a una API real.
---

# Primeros pasos: una solicitud HTTP

Vas a definir `GET /users/:id`, ejecutarlo con un cliente explícito y decodificar tanto el `200` como el `404` declarado. El handler local mantiene la primera ejecución offline; el comando no cambia cuando cambias a un servicio real.

## Step 1 — Instalar

`@defjs/core` es ESM y quiere Node.js 22+, Bun o Deno. Node ejecuta el `.ts` tal cual — pon `"type": "module"` en package.json. En el navegador sigues necesitando tu bundler y Fetch.

::: tabs
== bun

```sh
bun add @defjs/core
```

== npm

```sh
npm install @defjs/core
```

== pnpm

```sh
pnpm add @defjs/core
```

== yarn

```sh
yarn add @defjs/core
```

== deno

```sh
deno add npm:@defjs/core
```

:::

## Step 2 — Definir la solicitud

Crea `src/get-user.ts`. El struct de input es el valor de quien llama. `builder` coloca ese valor en la solicitud. Aquí todo el input es el objeto de path, así que los campos escalares sin alias rellenan `:id`.

```ts get-user.ts
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
})

const NotFound = struct.object({
  message: struct.string(),
})

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
  error: NotFound,
})

const command = getUser({ id: 7 })
void command
```

`output` es el cuerpo 2xx. `error` es cualquier otro estado. Un struct cada uno. Usa `struct.or(...)` o una unión discriminada cuando esos cuerpos difieran.

`defineRequest(...)` devuelve un endpoint. Llamar a `getUser(...)` construye el comando opaco que pasarás a `client.execute(...)`. El `builder` de arriba es la función que coloca el input; no es el endpoint.

## Step 3 — Ejecutarlo en local

Conecta un handle Fetch local al cliente para poder ejecutar sin red. Defjs sigue validando la entrada, construyendo el `Request`, despachando por estado y parseando el cuerpo.

```ts get-user.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
})

const NotFound = struct.object({
  message: struct.string(),
})

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
  error: NotFound,
})

const handle: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const id = new URL(request.url).pathname.split('/').at(-1)

  if (id === '7') {
    return Response.json({ id: 7, name: 'Ada' }, { status: 200 })
  }

  return Response.json({ message: 'User not found' }, { status: 404 })
}

const client = createClient(withEndpoint('https://api.example.test'), withHTTPHandle(handle))

const [error, user, response] = await client.execute(getUser({ id: 7 }), {
  timeout: 5_000,
})

if (error) {
  if (error.code === 'HTTP_STATUS' && error.status === 404) {
    console.log(error.data.message)
  } else {
    console.error(error.code)
  }
} else {
  console.log(`Loaded ${user.name} from ${response.status}`)
}
```

Ejecútalo:

::: tabs
== bun

```sh
bun src/get-user.ts
```

== npm

```sh
node src/get-user.ts
```

== pnpm

```sh
node src/get-user.ts
```

== yarn

```sh
node src/get-user.ts
```

== deno

```sh
deno run src/get-user.ts
```

:::

```txt
Loaded Ada from 200
```

Prueba un usuario que falta — cambia el id del path a `8` y vuelve a ejecutar:

```txt
User not found
```

En éxito: `error` es `null`, `user` es la salida Struct del `200`, `response` es un `HttpResponse`. En un `404` declarado: `error.code` es `'HTTP_STATUS'`, `error.status` es `404` y `error.data` está tipado como `NotFound`. El segundo elemento de la tupla es `undefined` en fallo.

## Step 4 — Apuntar a una API real

Quita `withHTTPHandle(...)` y pon la URL base real cuando el servicio implemente `GET /v1/users/:id` con esos cuerpos.

```ts
import { createClient, withEndpoint, withHTTPHandle } from '@defjs/core'

const localHandle: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const id = new URL(request.url).pathname.split('/').at(-1)

  if (id === '7') {
    return Response.json({ id: 7, name: 'Ada' }, { status: 200 })
  }

  return Response.json({ message: 'User not found' }, { status: 404 })
}

const localClient = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(localHandle))
const realClient = createClient(withEndpoint('https://api.example.com/v1'))
void localClient
void realClient
```

Mismo comando. Cliente distinto.

## Cuando el resultado cambia

- Entrada mala → `REQ_INPUT_INVALID`; opciones de cancel conflictivas → `REQ_OPTIONS_INVALID`; un
  `build` que falla → `REQ_BUILD_FAILED`
- Cualquier no-2xx → `HTTP_STATUS`, con `err.data` tipado si declaraste `error`
- Media type incorrecto → `RES_MEDIA_TYPE_INVALID`, avisado antes de leer el cuerpo
- Cuerpo declarado que no decodifica → `RES_DECODE_FAILED` o `RES_STRUCT_MISMATCH`
- Fallo de Fetch / cancel / timeout → `NET_UNREACHABLE` / `NET_ABORTED` / `NET_TIMEOUT`

`timeout` debe ser un entero seguro positivo en `1..2_147_483_647`. Formas de cancel válidas: `{ timeout }`, `{ abort }`, o `{ signal, timeout }` / `{ signal, abort }`. `{ abort, timeout }` juntos es inválido. La cancelación te dice lo que vio el llamador — no si una escritura en el servidor se confirmó.

## Siguientes recetas

- [GET con un 404 declarado](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Cancelar una llamada HTTP](../recipes/cancel-http.md)
- [Consumir un stream SSE](../recipes/consume-sse.md)
- [Abrir una sesión WebSocket](../recipes/websocket-session.md)
- [Probar con un handle Fetch local](../recipes/test-with-handle.md)
