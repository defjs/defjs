---
title: 'Getting Started: one HTTP request'
description: Define GET /users/:id, run it against a local Fetch handle, then point it at a real API.
---

# Getting Started: one HTTP request

You’ll define `GET /users/:id`, execute it through an explicit client, and decode both `200` and declared `404`. The local handler keeps the first run offline; the command stays the same when you swap in a real service.

## Step 1 — Install

`@defjs/core` is ESM and wants Node.js 22+, Bun, or Deno. Node runs the `.ts` file directly — keep `"type": "module"` in package.json. In a browser you still need your bundler and Fetch.

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

## Step 2 — Define the request

Create `src/get-user.ts`. The input struct is the caller's value. `builder` places that value on the request. Here the whole input is the path object, so alias-free scalar fields fill `:id`.

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

`output` is the 2xx body. `error` is every other status. One struct each. Use `struct.or(...)` or a discriminated union when those bodies differ.

`defineRequest(...)` returns an endpoint. Calling `getUser(...)` builds the opaque command you’ll pass to `client.execute(...)`. The `builder` above is the function that places input; it is not the endpoint.

## Step 3 — Execute it locally

Wire a client-local Fetch handle so you can run without a network. Defjs still validates input, builds the `Request`, dispatches by status, and parses the body.

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

Run it:

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

Try a missing user — change the path id to `8` and run again:

```txt
User not found
```

On success: `error` is `null`, `user` is the `200` Struct output, `response` is an `HttpResponse`. On a declared `404`: `error.code` is `'HTTP_STATUS'`, `error.status` is `404`, and `error.data` is typed `NotFound`. The second tuple item is `undefined` on failure.

## Step 4 — Point at a real API

Drop `withHTTPHandle(...)` and set the real base URL when the service implements `GET /v1/users/:id` with those bodies.

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

Same command. Different client.

## When the result differs

- Bad input → `REQ_INPUT_INVALID`; conflicting cancel options → `REQ_OPTIONS_INVALID`; a failing
  `build` → `REQ_BUILD_FAILED`
- Any non-2xx → `HTTP_STATUS`, with typed `err.data` when `error` was declared
- Wrong media type → `RES_MEDIA_TYPE_INVALID`, reported before the body is read
- A declared body that won't decode → `RES_DECODE_FAILED` or `RES_STRUCT_MISMATCH`
- Fetch fail / cancel / timeout → `NET_UNREACHABLE` / `NET_ABORTED` / `NET_TIMEOUT`

`timeout` must be a positive safe integer in `1..2_147_483_647`. Valid cancel shapes: `{ timeout }`, `{ abort }`, or `{ signal, timeout }` / `{ signal, abort }`. `{ abort, timeout }` together is invalid. Cancellation tells you what the caller saw — not whether a server write committed.

## Next recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
- [Consume an SSE stream](../recipes/consume-sse.md)
- [Open a WebSocket session](../recipes/websocket-session.md)
- [Test with a local Fetch handle](../recipes/test-with-handle.md)
