---
title: Interceptores
description: Constructores de interceptor HTTP, SSE y WebSocket.
---

# Interceptores

Envuelve `next` para un transporte. Regístralos con `withInterceptors`. Las listas mixtas se filtran por kind en el momento de execute.

## createHttpInterceptor() {#createHttpInterceptor}

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

Llama a `next(req)` (opcionalmente una solicitud mutada) o cortocircuita con `makeResponse`.

## createSSEInterceptor() {#createSSEInterceptor}

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` extiende `AsyncDisposable`. Una implementación estructural de cortocircuito debe proporcionar `[Symbol.asyncDispose](): PromiseLike<void>` y conectarlo al mismo ciclo de vida de close.

## createWebSocketInterceptor() {#createWebSocketInterceptor}

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` es la sesión que ve el interceptor:

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

Un wrapper o una sesión de cortocircuito debe reenviar el mismo teardown de `[Symbol.asyncDispose]()` que su ciclo de vida `close` / `closed`; devolver una promise resuelta ajena no basta. Exigir este miembro es un cambio breaking en tiempo de compilación para implementaciones estructurales. El código que solo acepta sesiones devueltas por Defjs no tiene un requisito adicional de llamada en runtime.

## Tipos con tag

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

## Auth básica

## basicAuthHttpInterceptor() {#basicAuthHttpInterceptor}

## basicAuthSSEInterceptor() {#basicAuthSSEInterceptor}

## BasicAuthInterceptorOptions {#BasicAuthInterceptorOptions}

```ts
function basicAuthHttpInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): HttpInterceptor

function basicAuthSSEInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): SSEInterceptor
```

`fn` se llama por solicitud. `encode` opcional en `BasicAuthInterceptorOptions` reemplaza el valor por defecto de la cabecera `Basic …`.

Mira la [guía de Interceptores](/core/interceptors).
