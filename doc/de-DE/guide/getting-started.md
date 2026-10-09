---
title: 'Erste Schritte: ein HTTP-Request'
description: Definiere GET /users/:id, führe ihn gegen ein lokales Fetch-Handle aus, dann zeige auf eine echte API.
---

# Erste Schritte: ein HTTP-Request

Du definierst `GET /users/:id`, führst ihn über einen expliziten Client aus und dekodierst sowohl `200` als auch deklariertes `404`. Der lokale Handler hält den ersten Lauf offline; der Command bleibt derselbe, wenn du einen echten Service einhängst.

## Schritt 1 — Installieren

`@defjs/core` ist ESM und will Node.js 22+, Bun oder Deno. Node führt die `.ts`-Datei direkt aus — `"type": "module"` in die package.json. Im Browser brauchst du weiterhin Bundler und Fetch.

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

## Schritt 2 — Request definieren

Lege `src/get-user.ts` an. Der Input-Struct ist der Wert des Callers. `builder` platziert diesen Wert auf dem Request. Hier ist der ganze Input das Path-Object, also füllen alias-freie Scalar-Fields `:id`.

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

`output` ist der 2xx-Body. `error` ist jeder andere Status. Je ein Struct. Nutze `struct.or(...)` oder eine Discriminated Union, wenn diese Bodies auseinanderlaufen.

`defineRequest(...)` gibt einen Endpoint zurück. Der Aufruf `getUser(...)` baut den opaken Command, den du an `client.execute(...)` übergibst. Der `builder` oben ist die Function, die Input platziert; er ist nicht der Endpoint.

## Schritt 3 — Lokal ausführen

Verdrahte ein client-lokales Fetch-Handle, damit du ohne Netzwerk laufen kannst. Defjs validiert weiterhin Input, baut den `Request`, dispatcht nach Status und parst den Body.

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

So startest du:

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

Probier einen fehlenden User — ändere die Path-id auf `8` und lauf nochmal:

```txt
User not found
```

Bei Erfolg: `error` ist `null`, `user` ist der `200`-Struct-Output, `response` ist ein `HttpResponse`. Bei deklariertem `404`: `error.code` ist `'HTTP_STATUS'`, `error.status` ist `404`, und `error.data` ist typisiert als `NotFound`. Der zweite Tupel-Eintrag ist bei Fehler `undefined`.

## Schritt 4 — Auf eine echte API zeigen

Lass `withHTTPHandle(...)` weg und setze die echte Base-URL, wenn der Service `GET /v1/users/:id` mit diesen Bodies implementiert.

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

Gleicher Command. Anderer Client.

## Wenn das Ergebnis abweicht

- Schlechter Input → `REQ_INPUT_INVALID`; konfliktierende Cancel-Options → `REQ_OPTIONS_INVALID`; ein fehlschlagendes
  `build` → `REQ_BUILD_FAILED`
- Jedes Non-2xx → `HTTP_STATUS`, mit typisiertem `err.data`, wenn `error` deklariert war
- Falscher Media-Type → `RES_MEDIA_TYPE_INVALID`, gemeldet bevor der Body gelesen wird
- Ein deklarierter Body, der nicht dekodiert → `RES_DECODE_FAILED` oder `RES_STRUCT_MISMATCH`
- Fetch-Fail / Cancel / Timeout → `NET_UNREACHABLE` / `NET_ABORTED` / `NET_TIMEOUT`

`timeout` muss eine positive Safe Integer in `1..2_147_483_647` sein. Gültige Cancel-Shapes: `{ timeout }`, `{ abort }` oder `{ signal, timeout }` / `{ signal, abort }`. `{ abort, timeout }` zusammen ist ungültig. Cancellation sagt dir, was der Caller gesehen hat — nicht, ob ein Server-Write committed hat.

## Nächste Rezepte

- [GET mit deklariertem 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [HTTP-Aufruf abbrechen](../recipes/cancel-http.md)
- [SSE-Stream konsumieren](../recipes/consume-sse.md)
- [WebSocket-Session öffnen](../recipes/websocket-session.md)
- [Mit lokalem Fetch-Handle testen](../recipes/test-with-handle.md)
