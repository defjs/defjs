---
title: 401에서 Bearer 토큰을 한 번 갱신하기
description: Authorization 첨부와 한 번의 재생을 interceptor 하나에 두고, next()는 안쪽으로만 가요.
---

# 401에서 Bearer 토큰을 한 번 갱신하기

`next()`는 **이** onion의 나머지예요. 바깥에서 `axios(config)`로 다시 디스패치하는 게 아니에요. 첨부, single-flight 갱신, 재생 한 번을 HTTP interceptor **하나**에 두어야 바깥 층이 두 번 돌지 않아요.

[인터셉터](../core/interceptors.md)를 보세요.

```ts twoslash refresh-bearer.ts
import { createClient, createHttpInterceptor, defineRequest, struct, withEndpoint, withHTTPHandle, withInterceptors } from '@defjs/core'

const getInvoice = defineRequest({
  method: 'GET',
  path: '/v1/invoice',
  output: struct.object({ total: struct.number() }),
  error: struct.object({ code: struct.literal('expired_token') }),
})

type Credential = { accessToken: string }

function refreshingBearer(read: () => Credential, refresh: (stale: Credential) => Promise<Credential>) {
  let flight: Promise<Credential> | undefined

  return createHttpInterceptor(async (request, next) => {
    const authorize = (credential: Credential) => {
      const headers = new Headers(request.headers)
      headers.set('authorization', `Bearer ${credential.accessToken}`)
      return { ...request, headers }
    }

    const used = read()
    const response = await next(authorize(used))
    const body = response.body
    if (response.status !== 401 || typeof body !== 'object' || body === null || !('code' in body) || body.code !== 'expired_token') {
      return response
    }

    const current = read()
    if (current.accessToken !== used.accessToken) return next(authorize(current))

    flight ??= refresh(used).finally(() => {
      flight = undefined
    })
    const refreshed = await flight
    return next(authorize(refreshed))
  })
}

let credential: Credential = { accessToken: 'v1' }
const handle: typeof fetch = async (input, init) => {
  const auth = new Request(input, init).headers.get('authorization')
  if (auth === 'Bearer v1') return Response.json({ code: 'expired_token' }, { status: 401 })
  return Response.json({ total: 42 }, { status: 200 })
}

const client = createClient(
  withEndpoint('https://billing.example.test'),
  withHTTPHandle(handle),
  withInterceptors(
    refreshingBearer(
      () => credential,
      async () => {
        credential = { accessToken: 'v2' }
        return credential
      },
    ),
  ),
)

const [error, invoice] = await client.execute(getInvoice())
console.log(error, invoice?.total)
```

```txt
null 42
```

`next`를 다시 호출하면 이 층 **안쪽**의 interceptor(그리고 Fetch 핸들러)만 다시 들어가요. 바깥의 타이밍/인증 wrapper는 다시 돌지 않아요. 그래서 401 배치는 두 번째 `execute`가 아니라 interceptor 하나에 있어야 해요.
