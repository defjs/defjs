---
title: Rafraîchir un Bearer une fois sur 401
description: Pose Authorization et rejoue une fois dans un seul intercepteur ; next() ne va que vers l’intérieur.
---

# Rafraîchir un Bearer une fois sur 401

`next()` est le reste de **cet** oignon — pas un `axios(config)` redistribué de l’extérieur. Mets l’attache + le refresh single-flight + un replay dans **un** intercepteur HTTP pour que les couches externes ne tournent pas deux fois.

Voir [Intercepteurs](../core/interceptors.md).

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

Rappeler `next` ne ré-entre que dans les intercepteurs **à l’intérieur** de cette couche (et le handler Fetch). Il ne relance pas les wrappers externes de timing/auth — c’est pourquoi le layout 401 appartient à un seul intercepteur, pas à un second `execute`.
