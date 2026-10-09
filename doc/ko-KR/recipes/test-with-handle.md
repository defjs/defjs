---
title: 로컬 Fetch 핸들로 테스트하기
description: withHTTPHandle로 그 클라이언트의 Fetch만 바꾸고 명령은 그대로 둬요.
---

# 로컬 Fetch 핸들로 테스트하기

`withHTTPHandle(...)`은 그 클라이언트의 Fetch만 바꿔요. DNS, TLS, 실제 서버 없이도 URL 구성, interceptor, status 디스패치, Struct 디코딩은 그대로예요.

자세한 내용은 [클라이언트](../core/client.md)를 보세요.

```ts twoslash get-user.test.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const handle: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const id = new URL(request.url).pathname.split('/').at(-1)
  if (id === '7') return Response.json({ id: 7, name: 'Ada' }, { status: 200 })
  return Response.json({ message: 'User not found' }, { status: 404 })
}

const client = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(handle))
const [error, user, response] = await client.execute(getUser({ path: { id: 7 } }))

if (error) throw error
console.log(user.name, response.status)
```

```txt
Ada 200
```

프로덕션에서는 같은 `getUser` 명령을 실제 `withEndpoint(...)` 클라이언트에 쓰세요. 바뀌는 것은 handle뿐이에요.
