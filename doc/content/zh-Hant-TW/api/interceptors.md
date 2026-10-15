---
title: Interceptors
description: HTTP、SSE、WebSocket interceptor 的 constructors。
---

# Interceptors

針對一種傳輸包住 `next`。用 `withInterceptors` 註冊。混合清單在執行時依 kind 篩選。

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

呼叫 `next(req)`（可以是改過的 request），或用 `makeResponse` 短接。`next` 只往內走：先到在這個 interceptor 之後註冊的 interceptors，再到傳輸層。再次呼叫它，會從這個 interceptor 起重新執行那段內層流程；外層的 interceptors 不會執行兩次。

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` 擴充了 `AsyncDisposable`。結構化短接實作必須提供 `[Symbol.asyncDispose](): PromiseLike<void>`，並接到同一條 close lifecycle。

## createWebSocketInterceptor()

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` 是 interceptor 看到的 session：

```ts
interface WebSocketSessionLike extends AsyncDisposable {
  readonly bufferedAmount: number
  readonly connection: WebSocketConnectionInfo
  readonly closed: Promise<WebSocketCloseInfo>
  readonly receive: AsyncIterable<unknown>
  readonly state: WebSocketState
  close(code?: number, reason?: string): void
  [Symbol.asyncDispose](): PromiseLike<void>
  onRuntimeError(listener: (error: unknown) => void): () => void
  onStateChange(listener: (state: WebSocketState) => void): () => void
  send(message: unknown): void
}
```

Wrapper 或短接 session 必須轉發與其 `close` / `closed` lifecycle 相同的 `[Symbol.asyncDispose]()` teardown；回傳無關的 resolved promise 並不足夠。要求這個成員，對結構化實作而言是編譯期 breaking change。只接收 Defjs session 的程式碼不必新增執行期呼叫。

## 帶 kind 的型別

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

```ts
type Interceptor = HttpInterceptor | SSEInterceptor | WebSocketInterceptor

interface HttpInterceptor {
  kind: 'http'
  fn: InterceptorFn
}
interface SSEInterceptor {
  kind: 'sse'
  fn: SSEInterceptorFn
}
interface WebSocketInterceptor {
  kind: 'web-socket'
  fn: WebSocketInterceptorFn
}
```

## 基本認證

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

```ts
function basicAuthHttpInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): HttpInterceptor

function basicAuthSSEInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): SSEInterceptor

type BasicAuthInterceptorOptions = {
  encode?: (credential: { username: string; password: string }) => string
}
```

在每個 request 上設定 `Authorization: Basic <encoded>`。每次 request 都會呼叫 `fn`。`encode` 回傳 `Basic ` 之後的部分；預設是 `btoa('username:password')`。沒有提供 `encode` 時，若 `btoa` 不可用，建立 interceptor 就會丟出錯誤。

見 [Interceptors 指南](/zh-Hant-TW/docs/interceptors)。
