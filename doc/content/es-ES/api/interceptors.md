---
title: Interceptores
description: Constructores de interceptor HTTP, SSE y WebSocket.
---

# Interceptores

Envuelve `next` para un transporte. Regístralos con `withInterceptors`. Las listas mixtas se filtran por kind en el momento de execute.

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

Llama a `next(req)` (opcionalmente una solicitud mutada) o cortocircuita con `makeResponse`. `next` solo avanza hacia dentro: hacia los interceptores registrados después de este y luego hacia el transporte. Llamarlo de nuevo repite esa parte interna desde este interceptor; los interceptores externos no se ejecutan dos veces.

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` extiende `AsyncDisposable`. Una implementación estructural de cortocircuito debe proporcionar `[Symbol.asyncDispose](): PromiseLike<void>` y conectarlo al mismo ciclo de vida de close.

## createWebSocketInterceptor()

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

## Auth básica

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

Establece `Authorization: Basic <encoded>` en cada solicitud. `fn` se llama por solicitud. `encode` devuelve la parte posterior a `Basic `; el valor por defecto es `btoa('username:password')`. Sin `encode`, crear el interceptor lanza si `btoa` no está disponible.

Mira la [guía de Interceptores](/es-ES/docs/interceptors).
