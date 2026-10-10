---
title: Commandes
description: Définis des endpoints, construis des commandes opaques, place les entrées et infère les résultats de transport.
---

# Commandes

Une définition → endpoint → commande opaque → `client.execute`. Même pipeline pour HTTP, SSE et WebSocket.

## Basic Setup

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## Choisir une définition

| Définition               | Contrat                                                                    | Valeur en succès                             |
| ------------------------ | -------------------------------------------------------------------------- | -------------------------------------------- |
| `defineRequest(...)`     | Méthode, chemin relatif, entrée optionnelle, `output` / `error` optionnels | Données décodées + réponse                   |
| `defineEventStream(...)` | Chemin, limites de buffer/queue, map nom d’événement → Struct              | `EventStreamHandle` + instantané open        |
| `defineWebSocket(...)`   | Chemin, un struct entrant, struct sortant optionnel, limite de queue       | `WebSocketSession` + instantané de connexion |

Pas d’`input` → l’endpoint ne prend pas d’argument, et `builder` peut être `() => request`. Avec `input` → passe la valeur du struct. Un champ optionnel peut être omis ; un champ requis non.

Garde les commandes opaques. Ne fouille pas les tags ni les symboles.

## Où vont les valeurs

Le struct décide comment une valeur est encodée. Le `builder` décide où elle va. `builder` est une fonction synchrone pure de l’entrée **parsée**. Il tourne à l’execute. Un throw devient `REQ_BUILD_FAILED` sur le tuple — l’appel de l’endpoint lui-même ne throw pas.

Un `input` déclaré exige toujours un `builder` explicite, même si l’entrée a déjà la forme de la requête. Seules les définitions sans `input` peuvent omettre `builder`.

Fais passer la valeur typée. Alias, `Date` → ISO et `bigint` → string s’appliquent ensuite partout où ce struct est utilisé : placement de la requête, décodage de la réponse, événements SSE et frames WebSocket.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
  email: struct.string(),
})

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({ user: User }),
  builder: (input) => ({ body: input.user }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})
void createUser
```

Le corps est le JSON `{"display_name":"…","email":"…"}`. Une clé écrite à la main est la trappe de sortie : `body: { name: input.user.displayName }` envoie `name`, parce que l’objet parent est anonyme et que l’alias ne s’applique pas.

## Quand les formes diffèrent

Utilise `builder` pour les placeholders de path, les littéraux et les branches. Il reçoit la vraie valeur, donc `if`, `??`, les templates et `switch` marchent.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const search = defineRequest({
  method: 'GET',
  path: '/orgs/:org_id/users',
  input: struct.object({
    orgId: struct.number(),
    query: struct.object({
      keyword: struct.string(),
      pageSize: struct.number().alias('page_size'),
    }),
  }),
  builder: (input) => ({
    path: { org_id: input.orgId },
    query: input.query,
    headers: { 'x-api-version': '2' },
  }),
  output: struct.object({ items: struct.array(struct.string()) }),
})
void search
```

`query: input.query` envoie `page_size`. `headers: { 'x-api-version': '2' }` est un littéral. L’auth et le tracing restent dans les intercepteurs : ils voient la requête native après le builder.

## Formes de `output` et `error`

`output` est un Struct pour le corps 2xx ; `error` est un Struct pour tout le reste. `ok` est le seul
embranchement, et un seul côté décode jamais. Omettre un côté veut dire que ce corps n’est jamais lu : le fault
porte le statut et `data` reste `undefined`.

## Recettes liées

- [GET avec un 404 déclaré](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
