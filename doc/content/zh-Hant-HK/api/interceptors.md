---
title: Interceptors
description: HTTP、SSE 同 WebSocket interceptor constructors。
---

# Interceptors

為一個 transport wrap `next`。用 `withInterceptors` register。Mixed lists 會喺 execute 時按 kind filter。

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

Call `next(req)`（可以傳已 mutate 嘅 request），或者用 `makeResponse` short-circuit。`next` 只會向內走：先去喺呢個 interceptor 之後註冊嘅 interceptors，再去 transport。再 call 一次，會由呢個 interceptor 重新行一次內層嗰部分；外層 interceptors 唔會運行兩次。

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` extend 咗 `AsyncDisposable`。Structural short-circuit implementation 必須 provide `[Symbol.asyncDispose](): PromiseLike<void>`，再接去同一條 close lifecycle。

## createWebSocketInterceptor()

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` 係 interceptor 見到嘅 session：

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

Wrapper 或 short-circuit session 必須 forward 同佢 `close` / `closed` lifecycle 一樣嘅 `[Symbol.asyncDispose]()` teardown；return 一個無關嘅 resolved promise 並唔夠。要求呢個 member，對 structural implementation 嚟講係 compile-time breaking change。淨係接收 Defjs session 嘅 code 唔使加新 runtime call。

## 帶 kind 嘅類型

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

每個 request 都會設定 `Authorization: Basic <encoded>`。`fn` 每個 request call 一次。`encode` 返回 `Basic ` 之後嗰部分；預設係 `btoa('username:password')`。冇 `encode` 而 `btoa` 又用唔到嘅話，建立 interceptor 時會 throw。

睇 [Interceptors guide](/zh-Hant-HK/docs/interceptors)。
