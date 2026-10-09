---
title: GET с объявленным 404
description: Выполни один GET и ветвись по типизированному 200 vs объявленному 404.
---

# GET с объявленным 404

Объяви и success, и 404 тела. Ветвись по `error.code` и `error.status` — для объявленного miss получишь типизированный `error.data`.

Подробности — в [HTTP](../core/http.md) и [Ошибки](../core/errors.md).

```ts twoslash get-user.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
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

Любой non-2xx статус — это `HTTP_STATUS`. Объявленный `error` даёт его телу тип; без `error` `err.data` остаётся `undefined`, а тело не читают. Один Struct `error` покрывает все non-2xx статусы, поэтому при разных формах используй `struct.or(...)` или размеченное объединение.
