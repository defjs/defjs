---
title: 'Bien démarrer : une requête HTTP'
description: Définis GET /users/:id, exécute-la via un handle Fetch local, puis pointe-la vers une vraie API.
---

# Bien démarrer : une requête HTTP

Tu vas définir `GET /users/:id`, l’exécuter via un client explicite, et décoder à la fois `200` et un `404` déclaré. Le handler local garde le premier run hors ligne ; la commande reste la même quand tu branches un vrai service.

## Étape 1 — Installer

`@defjs/core` est ESM et veut Node.js 22+, Bun ou Deno. Node exécute le `.ts` directement — mets `"type": "module"` dans package.json. Dans un navigateur, tu as toujours besoin de ton bundler et de Fetch.

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

## Étape 2 — Définir la requête

Crée `src/get-user.ts`. Le struct d’entrée est la valeur de l’appelant. `builder` place cette valeur sur la requête. Ici toute l’entrée est l’objet de path, donc les champs scalaires sans alias remplissent `:id`.

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

`output` est le corps 2xx. `error` est tout autre statut. Un struct chacun. Utilise `struct.or(...)` ou une union discriminée quand ces corps diffèrent.

`defineRequest(...)` renvoie un endpoint. Appeler `getUser(...)` construit la commande opaque que tu passeras à `client.execute(...)`. Le `builder` ci-dessus est la fonction qui place l’entrée ; ce n’est pas l’endpoint.

## Étape 3 — L’exécuter en local

Branche un handle Fetch local au client pour tourner sans réseau. Defjs valide quand même l’entrée, construit la `Request`, dispatche par statut et parse le corps.

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

Lance-le :

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

Essaie un utilisateur manquant — change l’id de path en `8` et relance :

```txt
User not found
```

En succès : `error` est `null`, `user` est la sortie Struct du `200`, `response` est un `HttpResponse`. Sur un `404` déclaré : `error.code` est `'HTTP_STATUS'`, `error.status` est `404`, et `error.data` est typé `NotFound`. Le deuxième élément du tuple est `undefined` en échec.

## Étape 4 — Pointer vers une vraie API

Enlève `withHTTPHandle(...)` et pose la vraie URL de base quand le service implémente `GET /v1/users/:id` avec ces corps.

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

Même commande. Client différent.

## Quand le résultat change

- Mauvaise entrée → `REQ_INPUT_INVALID` ; options d’annulation en conflit → `REQ_OPTIONS_INVALID` ; un
  `build` qui échoue → `REQ_BUILD_FAILED`
- Tout non-2xx → `HTTP_STATUS`, avec `err.data` typé quand `error` a été déclaré
- Mauvais media type → `RES_MEDIA_TYPE_INVALID`, signalé avant la lecture du corps
- Un corps déclaré qui ne décode pas → `RES_DECODE_FAILED` ou `RES_STRUCT_MISMATCH`
- Échec Fetch / annulation / timeout → `NET_UNREACHABLE` / `NET_ABORTED` / `NET_TIMEOUT`

`timeout` doit être un entier sûr positif dans `1..2_147_483_647`. Formes d’annulation valides : `{ timeout }`, `{ abort }`, ou `{ signal, timeout }` / `{ signal, abort }`. `{ abort, timeout }` ensemble est invalide. L’annulation te dit ce que l’appelant a vu — pas si une écriture serveur a été commitée.

## Recettes suivantes

- [GET avec un 404 déclaré](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Annuler un appel HTTP](../recipes/cancel-http.md)
- [Consommer un flux SSE](../recipes/consume-sse.md)
- [Ouvrir une session WebSocket](../recipes/websocket-session.md)
- [Tester avec un handle Fetch local](../recipes/test-with-handle.md)
