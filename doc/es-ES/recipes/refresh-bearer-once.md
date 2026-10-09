---
title: Refrescar un token Bearer una vez ante un 401
description: Adjunta Authorization y reintenta una vez dentro de un interceptor; next() solo va hacia dentro.
---

# Refrescar un token Bearer una vez ante un 401

`next()` es el resto de **esta** cebolla — no un reenvío `axios(config)` desde fuera. Pon el attach, el refresh single-flight y un replay en **un** interceptor HTTP para que las capas exteriores no corran dos veces.

Ver [Interceptores](../core/interceptors.md).

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

Llamar a `next` otra vez solo vuelve a entrar en los interceptores **dentro** de esta capa (y el handler Fetch). No reejecuta wrappers exteriores de timing/auth — por eso el layout del 401 va en un interceptor, no en un segundo `execute`.
