---
title: GET avec un 404 déclaré
description: Exécute un GET et branche sur 200 typé vs 404 déclaré.
---

# GET avec un 404 déclaré

Déclare les corps de succès et de 404. Branche sur `error.code` et `error.status` — tu obtiens `error.data` typé pour le miss déclaré.

Voir [HTTP](../core/http.md) et [Erreurs](../core/errors.md) pour les détails.

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

Tout statut non-2xx est `HTTP_STATUS`. Déclarer `error` donne un type à son corps ; l’omettre laisse `err.data` à `undefined` et le corps non lu. Un seul Struct `error` couvre tous les statuts non-2xx : utilise donc `struct.or(...)` ou une union discriminée quand les formes diffèrent.
