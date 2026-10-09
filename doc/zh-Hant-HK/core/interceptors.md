---
title: Interceptors
description: 用 onion order，喺 transport boundary 為 HTTP、SSE 同 WebSocket 疊 policy。
---

# Interceptors

加 auth headers、short-circuit maintenance windows，或者 retry safe reads — 又唔掂 command validation。每個 transport 有自己條 chain。你收到 `HttpRequest`；你 return 嗰個 transport 嘅 result（`HttpResponse`、event-stream handle，或者 WebSocket session）。Input validation 喺 chain 之前 run；status dispatch 同 decoded results 喺之後。

## Basic Setup

```typescript twoslash
import { createClient, createHttpInterceptor, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit))
void client
```

## Onion order

`withInterceptors(...items)` 接受 mixed interceptors。Client 會按選中嘅 transport 用 `kind` filter，並保留相對 registration order。每個 interceptor 可以喺 `next` 前後 run：

| Factory                      | Request       | Result from `next`                    |
| ---------------------------- | ------------- | ------------------------------------- |
| `createHttpInterceptor`      | `HttpRequest` | `Promise<HttpResponse<unknown>>`      |
| `createSSEInterceptor`       | `HttpRequest` | `Promise<EventStreamHandle<unknown>>` |
| `createWebSocketInterceptor` | `HttpRequest` | `Promise<WebSocketSessionLike>`       |

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

const order: string[] = []
const first = createHttpInterceptor(async (request, next) => {
  order.push('first:before')
  const response = await next(request)
  order.push('first:after')
  return response
})

const second = createHttpInterceptor(async (request, next) => {
  order.push('second:before')
  const response = await next(request)
  order.push('second:after')
  return response
})

// Request: first:before → second:before → transport
// Return: second:after → first:after
void [first, second, order]
```

多次 `withInterceptors(...)` 會 append。當外層一定要見到最終 result 時，將 broad observation 放喺 narrower mutation/retry 外面。

## Clone 同加 request headers

將入嚟嘅 `HttpRequest` 當係 chain own 住。改 `Headers` 之前先 clone；傳新 request 去 `next`：

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

function readAccessToken(): string | undefined {
  return undefined
}

const bearer = createHttpInterceptor((request, next) => {
  const token = readAccessToken()
  if (!token) return next(request)

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return next({ ...request, headers })
})
```

SSE 同一套 pattern。Browser WebSocket 唔可以加 arbitrary handshake headers — 改 `request.headers` 唔會 authenticate browser socket。改用 protocol、URL/query policy，或者 server-supported handshake。

Replace HTTP body 時，喺 copied request 上 replace `body`。Body value 變咗之後，Fetch 會 ignore stale content-type metadata。唔好 reuse 已經 consumed 嘅 `ReadableStream` body。

## Short-circuit 一個 request

你可以 skip `next`，但一定要 return 預期嘅 result type。對 HTTP，`makeResponse(...)` 會 build compatible wrapper：

```typescript twoslash
import { createHttpInterceptor, makeResponse } from '@defjs/core'

function isMaintenanceWindow(): boolean {
  return false
}

const maintenanceGate = createHttpInterceptor(async (_request, next) => {
  if (isMaintenanceWindow()) {
    return makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { message: 'Temporarily unavailable' },
    })
  }

  return next(_request)
})
```

Command layer 仍然會按 status dispatch。Callers 需要 typed `error.data` 時，用單一 `error` struct 描述非 2xx side。Short-circuit SSE 或者 WebSocket 需要完整 compatible handle/session（closure promises、live state、ownership 同 `[Symbol.asyncDispose]`）。Partial objects 唔係 valid policy。Structural `EventStreamHandle` 同 `WebSocketSessionLike` implementation 而家 compile 時必須有 standard disposer；淨係接收 Defjs handle 嘅 consumer 唔使加新 runtime call。

## Retry safe reads

Retries 會改行為。Keep policy 窄 — 呢個例子為 statuses `0`、`429`、`502`、`503`、`504` retry replayable `GET` / `HEAD` / `OPTIONS`，將 `Retry-After` cap 喺 30s，兩次 retries 或者 abort 就停：

```typescript twoslash
import { createHttpInterceptor, type HttpRequest, type HttpResponse } from '@defjs/core'

const retryableMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const retryableStatuses = new Set([0, 429, 502, 503, 504])

function isReplayable(request: HttpRequest): boolean {
  return typeof ReadableStream === 'undefined' || !(request.body instanceof ReadableStream)
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get('retry-after')
  if (!value) return 250

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000)

  const date = Date.parse(value)
  return Number.isNaN(date) ? 250 : Math.min(Math.max(0, date - Date.now()), 30_000)
}

function waitForRetryAfter(response: HttpResponse<unknown>, signal?: AbortSignal): Promise<void> {
  const delay = retryAfterMs(response)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(done, delay)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason)
    }

    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (!retryableMethods.has(request.method.toUpperCase()) || !isReplayable(request)) return next(request)

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request)
    if (!retryableStatuses.has(response.status) || attempt >= 2) return response
    await waitForRetryAfter(response, request.abort)
  }
})
```

呢個 loop 唔會 retry interceptor/Fetch 拋出嘅 errors——transport failure 係 reject，根本唔會生出一個俾呢個 loop 去 match 嘅 status。Retry `POST` / `PUT` / `PATCH` / `DELETE` 要 replayable bytes、server support、idempotency contract，同 reviewed status policy。Retry 由你自己管——Core 唔會 export `retryAfter()`。

喺呢個例子之外 throw（或者 reject）嘅 interceptor，會以 `EXT_INTERCEPTOR_FAILED` 返到 caller，拋出嘅值
掛喺 `cause` 上面——睇 [Errors](./errors.md)。想表達取消，就改為 throw `ERR_ABORTED` 或者 `ERR_TIMEOUT`。

`next(request)` 可能 reject。Transport failure 係 fault，唔係 status 0 嘅 response，所以想睇到佢嘅
interceptor 要喺 `next` 外面包 `try` / `catch`。Defjs 嘅歸因照樣正確：由 transport 嚟嘅 reject 依然係
`NET_*` fault，唔會賴落你個 interceptor 身上。

## Wrap WebSocket sessions

WebSocket interceptor 最多 call `next` 一次。如果你 wrap session，就要明確 delegate live getters 同 lifecycle members：

```typescript twoslash
import { createWebSocketInterceptor } from '@defjs/core'

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request)

  return {
    get bufferedAmount() {
      return session.bufferedAmount
    },
    get connection() {
      return session.connection
    },
    get state() {
      return session.state
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason)
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]()
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener)
    },
    onStateChange(listener) {
      return session.onStateChange(listener)
    },
    send(message: unknown) {
      session.send(message)
    },
  }
})
```

Spread session 會將 `state` / `connection` / `bufferedAmount` snapshot 一次。除非你刻意改 ownership，否則保留 `closed`、`receive`、`close`、精確嘅 `[Symbol.asyncDispose]()` delegation 同 listener cleanup。Wrapper 必須 return inner session 嘅 teardown promise，唔可以 return 無關嘅 resolved promise。如果 chain create 咗一個未 deliver 嘅 session，Core 會 settle 同 close 佢；如果成功嘅 interceptor return 唔同 session，Core 會 discard 原本 create 嗰個。

## Reference

Factories return tagged transport values：

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — HTTP 上嘅 Basic credentials
- `basicAuthSSEInterceptor(provider, options?)` — SSE 上嘅 Basic credentials

`HttpRequest` 可以包括 `endpoint`、`baseEndpoint`、`method`、`headers`、`body`、`queryParams`、`queryString`、`abort`、`timeout`，同 static `operation`。佢係 transport integration value — 唔係 caller 嘅 parsed input。Serialization 之後，`queryParams` 係 `new URLSearchParams(queryString)`。Builder 冇產生 query 嘅時候，configured query serializer 唔會被 call；builder 嘅 `URLSearchParams` 會原樣用。Command validation、output validation 同 domain error mapping 留喺各自嘅 layers。

SSE/WebSocket observers 係 lifecycle hooks，唔係 control flow。Owner 完結時 unsubscribe WebSocket listeners。Observer failures 跟 transport contract；interceptor 本身可以 throw 或者 reject。

Log reviewed allowlist：static `operation`、method、status、duration、stable error code。預設唔好 log resolved URLs、query strings、auth headers、bodies、raw causes、SSE event IDs 或者 WebSocket payloads。

Basic credentials 係 base64，唔係 encrypted。用 TLS，server 上保持 credential providers request-scoped，永遠唔好 log generated header。Default encoder 係 `globalThis.btoa`；runtime 冇 `btoa` 或者需要 reviewed encoder 時，傳 `BasicAuthInterceptorOptions.encode`。

Interceptor 可以 enforce transport policy。佢唔係 input validation、authorization，或者 resource ownership。開始 long-lived work 嘅 code 仍然要用 `await using`，或者 manual close 再 await terminal promise。普通 HTTP 係 request-scoped，用 timeout / `AbortSignal` manage，所以 `Client` 唔係 `AsyncDisposable`。

## Related recipes

- [401 時 refresh Bearer token 一次](../recipes/refresh-bearer-once.md)
- [Publish 一個唔隱藏 execute 嘅 HTTP SDK](../recipes/publish-http-sdk.md)
- [Test with a local Fetch handle](../recipes/test-with-handle.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
