---
title: Interceptors
description: HTTP, SSE, and WebSocket interceptor constructors.
---

# Interceptors

Wrap `next` for one transport. Register with `withInterceptors`. Mixed lists are filtered by kind at execute time.

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

Call `next(req)` (optionally a mutated request) or short-circuit with `makeResponse`. `next` only goes inward: to interceptors registered after this one, then the transport. Calling it again replays that inner part from this interceptor; outer interceptors do not run twice.

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` extends `AsyncDisposable`. A structural short-circuit implementation must provide `[Symbol.asyncDispose](): PromiseLike<void>` and connect it to the same close lifecycle.

## createWebSocketInterceptor()

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` is the interceptor-facing session:

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

A wrapper or short-circuit session must forward the same `[Symbol.asyncDispose]()` teardown as its `close` / `closed` lifecycle; returning an unrelated resolved promise is not sufficient. Requiring this member is a compile-time breaking change for structural implementations. Code that only accepts sessions returned by Defjs has no additional runtime call requirement.

## Tagged types

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

## Basic auth

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

Sets `Authorization: Basic <encoded>` on each request. `fn` is called per request. `encode` returns the part after `Basic `; the default is `btoa('username:password')`. Without `encode`, creating the interceptor throws when `btoa` is unavailable.

See [Interceptors guide](/docs/interceptors).
