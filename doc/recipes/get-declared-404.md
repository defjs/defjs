---
title: GET with a declared 404
description: Execute one GET and branch on typed 200 vs declared 404.
---

# GET with a declared 404

Declare both success and 404 bodies. Branch on `error.code` and `error.status` — you get typed `error.data` for the declared miss.

See [HTTP](../core/http.md) and [Errors](../core/errors.md) for details.

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

Every non-2xx status is `HTTP_STATUS`. Declaring `error` gives its body a type; omitting `error`
leaves `err.data` as `undefined` and the body unread. One `error` Struct covers every non-2xx
status, so use `struct.or(...)` or a discriminated union when the shapes differ.
