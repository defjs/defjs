---
title: Interceptors
description: 在傳輸邊界以洋蔥順序疊加 HTTP、SSE、WebSocket 政策。
---

# Interceptors

加 auth headers、短接維護時段，或重試安全的讀取 — 不必動到 command 驗證。每種傳輸有自己的 chain。你拿到 `HttpRequest`；回傳該傳輸的結果（`HttpResponse`、event-stream handle，或 WebSocket session）。Input 驗證在 chain 前；status 分派與解碼結果在之後。

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

## 洋蔥順序

`withInterceptors(...items)` 接受混合 interceptors。Client 依選定傳輸的 `kind` 篩選，並保留相對註冊順序。每個 interceptor 可以在 `next` 前後各跑一次：

| Factory                      | Request       | `next` 的結果                         |
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

多次 `withInterceptors(...)` 會追加。當外層必須看到最終結果時，把廣的 observation 放在較窄的 mutation／retry 外面。

## Clone 並加 request headers

把進來的 `HttpRequest` 當 chain 擁有的。改之前先 clone `Headers`；把新的 request 傳給 `next`：

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

SSE 同套路。瀏覽器 WebSocket 不能加任意 handshake headers — 改 `request.headers` 不會幫瀏覽器 socket 做認證。改用 protocol、URL／query 政策，或伺服器支援的 handshake。

替換 HTTP body 時，在複製後的 request 上換 `body`。Body 值變了時，Fetch 會忽略過期的 content-type metadata。別重用已消耗的 `ReadableStream` body。

## Short-circuit 請求

你可以跳過 `next`，但必須回傳預期的結果型別。HTTP 用 `makeResponse(...)` 建相容 wrapper：

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

Command 層仍會依 status 分派。呼叫端需要型別化 `error.data` 時，用單一 `error` struct 描述非 2xx 側。Short-circuit SSE 或 WebSocket 需要完整相容的 handle／session（closure promises、live state、ownership 與 `[Symbol.asyncDispose]`）。部分物件不算有效政策。結構化 `EventStreamHandle` 與 `WebSocketSessionLike` 實作現在編譯時必須提供標準 disposer；只接收 Defjs handle 的 consumer 不必新增執行期呼叫。

## 重試安全讀取

重試會改行為。政策收窄 — 這個例子對可重放的 `GET`／`HEAD`／`OPTIONS`，在 status `0`、`429`、`502`、`503`、`504` 時重試，把 `Retry-After` 上限設 30s，兩次重試後或 abort 時停止：

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

這個迴圈不會重試被丟出的 interceptor／Fetch 錯誤——傳輸失敗是 reject，根本不會產生一個能讓這個迴圈去比對的 status。重試 `POST`／`PUT`／`PATCH`／`DELETE` 需要可重放的 bytes、伺服器支援、idempotency 契約，以及審過的 status 政策。重試歸你管——Core 不會匯出 `retryAfter()`。

在這個範例之外丟出錯誤（或 reject）的 interceptor，會以 `EXT_INTERCEPTOR_FAILED` 回到呼叫方，丟出的值
掛在 `cause` 上——見 [Errors](./errors.md)。想表達取消，就改成丟 `ERR_ABORTED` 或 `ERR_TIMEOUT`。

`next(request)` 可能 reject。傳輸失敗是 fault，不是 status 0 的回應，所以想觀察它的 interceptor 要在
`next` 外面包一層 `try`／`catch`。Defjs 的歸因照樣正確：來自傳輸層的 reject 仍然是 `NET_*` fault，不會
算到你的 interceptor 頭上。

## 包裝 WebSocket sessions

WebSocket interceptor 最多呼叫一次 `next`。若你包裝 session，請明確委派 live getters 與生命週期成員：

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

Spread session 會把 `state`／`connection`／`bufferedAmount` 快照一次。除非你刻意改 ownership，否則保留 `closed`、`receive`、`close`、精確的 `[Symbol.asyncDispose]()` 轉發與 listener cleanup。Wrapper 必須回傳內部 session 的 teardown promise，不能回傳無關的 resolved promise。若 chain 建立了 session 卻沒交付，Core 會 settle 並關閉它；若成功的 interceptor 回傳不同的 session，Core 會丟掉建立出來的那個。

## Reference

Factories 回傳帶 tag 的傳輸值：

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — HTTP 上的 Basic credentials
- `basicAuthSSEInterceptor(provider, options?)` — SSE 上的 Basic credentials

`HttpRequest` 可能包含 `endpoint`、`baseEndpoint`、`method`、`headers`、`body`、`queryParams`、`queryString`、`abort`、`timeout`、static `operation`。它是傳輸整合值 — 不是呼叫端已剖析的 input。序列化之後，`queryParams` 是 `new URLSearchParams(queryString)`。Builder 沒產出 query 時，不會呼叫設定好的 query serializer；builder 的 `URLSearchParams` 會原樣使用。Command 驗證、output 驗證、網域錯誤對應留在各自的層。

SSE／WebSocket observers 是生命週期 hooks，不是控制流程。擁有者結束時要 unsubscribe WebSocket listeners。Observer 失敗跟傳輸契約走；interceptor 本身可以 throw 或 reject。

記審過的 allowlist：static `operation`、method、status、duration、穩定錯誤碼。預設別記解析後的 URLs、query strings、auth headers、bodies、raw causes、SSE event IDs、WebSocket payloads。

Basic credentials 是 base64，不是加密。用 TLS，伺服器上的 credential providers 保持請求範圍，永遠別記產生出的 header。預設 encoder 是 `globalThis.btoa`；runtime 沒有 `btoa` 或需要審過的 encoder 時，傳 `BasicAuthInterceptorOptions.encode`。

Interceptor 可以強制傳輸政策。它不是 input 驗證、授權或資源擁有權。啟動長期工作的程式碼仍要用 `await using`，或手動關閉並 await 終端 promise。一般 HTTP 是 request-scoped，透過 timeout / `AbortSignal` 管理，因此 `Client` 不是 `AsyncDisposable`。

## 相關 recipes

- [在 401 時只刷新一次 Bearer token](../recipes/refresh-bearer-once.md)
- [發布 HTTP SDK，且不要藏起 execute](../recipes/publish-http-sdk.md)
- [用本機 Fetch handle 測試](../recipes/test-with-handle.md)
- [取消 HTTP 呼叫](../recipes/cancel-http.md)
