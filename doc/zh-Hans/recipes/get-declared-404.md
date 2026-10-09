---
title: 声明了 404 的 GET
description: 执行一次 GET，按类型化的 200 和声明过的 404 分支。
---

# 声明了 404 的 GET

成功和 404 body 都声明好。按 `error.code` 和 `error.status` 分支——声明过的 miss 会给你类型化的 `error.data`。

细节见 [HTTP](../core/http.md) 和[错误](../core/errors.md)。

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

每个非 2xx 状态都是 `HTTP_STATUS`。声明 `error` 会给它的 body 一个类型；省略 `error` 则 `err.data` 是 `undefined`，body 也不会被读。一个 `error` Struct 覆盖所有非 2xx 状态，所以形状不同时用 `struct.or(...)` 或判别联合。
