---
title: Обнови Bearer-токен один раз на 401
description: Повесь Authorization и один replay внутри одного interceptor; next() идёт только внутрь.
---

# Обнови Bearer-токен один раз на 401

`next()` — это остаток **этой** луковицы, а не `axios(config)`, заново диспатчнутый снаружи. Клади attach + single-flight refresh + один replay в **один** HTTP interceptor, чтобы внешние слои не пробежали дважды.

См. [Interceptors](../core/interceptors.md).

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

Повторный `next` заново входит только в interceptors **внутри** этого слоя (и в Fetch handler). Внешние обёртки timing/auth он не прогоняет ещё раз — поэтому раскладка 401 живёт в одном interceptor, а не во втором `execute`.
