---
title: حدّث رمز Bearer مرة واحدة عند 401
description: ألحق Authorization وأعد التشغيل مرة داخل معترض واحد؛ وnext() يذهب إلى الداخل فقط.
---

# حدّث رمز Bearer مرة واحدة عند 401

`next()` هو بقية البصلة **هذه** — وليس إعادة إرسال `axios(config)` من الخارج. ضع الإلحاق + تحديث الرحلة الواحدة + إعادة تشغيل واحدة في معترض HTTP **واحد** حتى لا تعمل الطبقات الخارجية مرتين.

انظر [المعترضات](../core/interceptors.md).

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

استدعاء `next` مرة أخرى يعيد الدخول فقط إلى المعترضات **داخل** هذه الطبقة (ومعالج Fetch). ولا يعيد تشغيل أغلفة التوقيت/المصادقة الخارجية — لذلك ينتمي تخطيط 401 إلى معترض واحد، لا إلى `execute` ثانٍ.
