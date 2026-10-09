---
title: 선언된 404가 있는 GET
description: GET 하나를 실행하고 타입이 있는 200과 선언된 404로 분기해요.
---

# 선언된 404가 있는 GET

성공 body와 404 body를 둘 다 선언해요. `error.code`와 `error.status`로 분기하면, 선언된 miss의 타입이 있는 `error.data`를 받아요.

자세한 내용은 [HTTP](../core/http.md)와 [오류](../core/errors.md)를 보세요.

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

2xx가 아닌 status는 모두 `HTTP_STATUS`예요. `error`를 선언하면 그 body에 타입이 생기고, `error`를 빼면 `err.data`는 `undefined`이고 body는 읽히지 않아요. `error` Struct 하나가 모든 non-2xx status를 덮으니, 모양이 달라지면 `struct.or(...)`나 discriminated union을 쓰세요.
