---
title: Interceptors
description: Конструкторы interceptor’ов HTTP, SSE и WebSocket.
---

# Interceptors

Оберни `next` для одного транспорта. Регистрируй через `withInterceptors`. Смешанные списки фильтруются по kind в момент execute.

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

Зови `next(req)` (можно мутированный request) или short-circuit через `makeResponse`. `next` идёт только внутрь: к interceptor’ам, зарегистрированным после этого, а затем к транспорту. Повторный вызов заново проигрывает эту внутреннюю часть начиная с данного interceptor’а; внешние interceptor’ы дважды не выполняются.

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` расширяет `AsyncDisposable`. Структурная short-circuit реализация обязана предоставить `[Symbol.asyncDispose](): PromiseLike<void>` и связать его с тем же close lifecycle.

## createWebSocketInterceptor()

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` — session со стороны interceptor:

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

Wrapper или short-circuit session должен пересылать тот же teardown `[Symbol.asyncDispose]()`, что и его `close` / `closed` lifecycle; отдельного resolved promise недостаточно. Требование этого member — compile-time breaking change для структурных реализаций. Код, который только принимает session от Defjs, не обязан добавлять новый runtime-вызов.

## Типы с тегом

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

## Базовая аутентификация

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

Ставит `Authorization: Basic <encoded>` на каждый request. `fn` вызывается на каждый request. `encode` возвращает часть после `Basic `; по умолчанию это `btoa('username:password')`. Без `encode` создание interceptor’а бросает ошибку, если `btoa` недоступен.

См. [гайд Interceptors](/ru-RU/docs/interceptors).
