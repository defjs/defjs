---
title: Interceptors
description: HTTP-, SSE- und WebSocket-Interceptor-Constructors.
---

# Interceptors

Wrappe `next` für einen Transport. Registriere mit `withInterceptors`. Gemischte Listen werden zur Execute-Zeit nach kind gefiltert.

## createHttpInterceptor() {#createHttpInterceptor}

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

Ruf `next(req)` auf (optional ein mutierter Request) oder short-circuite mit `makeResponse`.

## createSSEInterceptor() {#createSSEInterceptor}

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` erweitert `AsyncDisposable`. Eine strukturelle Short-Circuit-Implementierung muss `[Symbol.asyncDispose](): PromiseLike<void>` liefern und ihn an denselben Close-Lifecycle hängen.

## createWebSocketInterceptor() {#createWebSocketInterceptor}

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` ist die interceptor-seitige Session:

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

Ein Wrapper oder eine Short-Circuit-Session muss denselben `[Symbol.asyncDispose]()`-Teardown wie ihren `close`- / `closed`-Lifecycle weiterleiten; ein fremdes resolved Promise reicht nicht. Dieses Member zu verlangen ist eine Compile-Time-Breaking-Änderung für strukturelle Implementierungen. Code, der nur von Defjs zurückgegebene Sessions akzeptiert, hat keine zusätzliche Runtime-Aufrufpflicht.

## Getaggte Typen

## Interceptor {#Interceptor}

## HttpInterceptor {#HttpInterceptor}

## SSEInterceptor {#SSEInterceptor}

## WebSocketInterceptor {#WebSocketInterceptor}

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

## Basic Auth

## basicAuthHttpInterceptor() {#basicAuthHttpInterceptor}

## basicAuthSSEInterceptor() {#basicAuthSSEInterceptor}

## BasicAuthInterceptorOptions {#BasicAuthInterceptorOptions}

```ts
function basicAuthHttpInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): HttpInterceptor

function basicAuthSSEInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): SSEInterceptor
```

`fn` wird pro Request aufgerufen. Optionales `encode` auf `BasicAuthInterceptorOptions` ersetzt den Default-`Basic …`-Header-Wert.

Siehe [Interceptors-Guide](/core/interceptors).
