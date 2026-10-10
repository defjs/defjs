---
title: GET mit deklariertem 404
description: Ein GET ausführen und zwischen typisiertem 200 und deklariertem 404 branchen.
---

# GET mit deklariertem 404

Deklariere sowohl Success- als auch 404-Bodies. Branche auf `error.code` und `error.status` — du bekommst typisiertes `error.data` für den deklarierten Miss.

Details siehe [HTTP](../core/http.md) und [Fehler](../core/errors.md).

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

Jeder Non-2xx-Status ist `HTTP_STATUS`. `error` zu deklarieren gibt dessen Body einen Typ; lässt du `error` weg, bleibt `err.data` `undefined` und der Body ungelesen. Ein einzelner `error`-Struct deckt jeden Non-2xx-Status ab — nutze also `struct.or(...)` oder eine Discriminated Union, wenn die Shapes abweichen.
