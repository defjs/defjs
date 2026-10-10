---
title: GET 配 declared 404
description: Execute 一次 GET，按 typed 200 vs declared 404 分支。
---

# GET 配 declared 404

同時 declare success 同 404 bodies。用 `error.code` 同 `error.status` 分支 — declared miss 會畀你 typed `error.data`。

詳情睇 [HTTP](../core/http.md) 同 [Errors](../core/errors.md)。

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

每個非 2xx status 都係 `HTTP_STATUS`。聲明 `error` 會俾佢個 body 一個 type；唔寫 `error` 就 `err.data` 係 `undefined`，body 亦唔會被讀。一個 `error` Struct 覆蓋所有非 2xx status，所以形狀唔同嘅時候用 `struct.or(...)` 或者 discriminated union。
