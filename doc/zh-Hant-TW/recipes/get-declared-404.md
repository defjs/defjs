---
title: 已宣告 404 的 GET
description: 執行一次 GET，並依型別化的 200 與已宣告 404 分支。
---

# 已宣告 404 的 GET

同時宣告成功與 404 body。用 `error.code` 與 `error.status` 分支 — 對已宣告的 miss 會拿到型別化的 `error.data`。

細節見 [HTTP](../core/http.md) 與[錯誤](../core/errors.md)。

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

每個非 2xx 狀態都是 `HTTP_STATUS`。宣告 `error` 會給它的 body 一個型別；省略 `error` 則 `err.data` 是 `undefined`，body 也不會被讀。一個 `error` Struct 覆蓋所有非 2xx 狀態，所以形狀不同時用 `struct.or(...)` 或判別聯集。
