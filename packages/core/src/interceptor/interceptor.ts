import type { HttpRequest } from '../internal/http_request'
import type { HttpResponse } from '../internal/http_response'
import type { EventStreamHandle } from '../sse/transport/event_stream'
import type { WebSocketCloseInfo, WebSocketState } from '../web_socket/web_socket'

// ---------------------------------------------------------------------------
// HTTP Interceptor
// ---------------------------------------------------------------------------

/**
 * Continuation that runs the rest of the HTTP interceptor chain (or the handler).
 *
 * `next(req)` only goes **inward** — remaining interceptors registered after this one,
 * then the Fetch handler. It is not a re-dispatch of `client.execute` / `axios(config)`
 * from the outside of the onion. Call `next` again for a safe replay (for example one
 * 401 refresh) from the same interceptor; outer layers do not run a second time.
 */
export type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>

/**
 * HTTP interceptor function: may inspect/modify the request, then call `next`.
 */
export type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>

/**
 * Tagged HTTP interceptor for client option lists.
 */
export interface HttpInterceptor {
  kind: 'http'
  fn: InterceptorFn
}

/**
 * Wrap an `InterceptorFn` as a tagged `HttpInterceptor`.
 *
 * @param fn - HTTP interceptor function.
 * @returns An `HttpInterceptor` with `kind: 'http'`.
 */
export function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor {
  return { kind: 'http', fn }
}

// ---------------------------------------------------------------------------
// SSE Interceptor
// ---------------------------------------------------------------------------

/**
 * Terminal SSE handler that opens an event stream for the given request.
 */
export type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>

/**
 * SSE interceptor function: may inspect/modify the request, then call `next`.
 */
export type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>

/**
 * Tagged SSE interceptor for client option lists.
 */
export interface SSEInterceptor {
  kind: 'sse'
  fn: SSEInterceptorFn
}

/**
 * Wrap an `SSEInterceptorFn` as a tagged `SSEInterceptor`.
 *
 * @param fn - SSE interceptor function.
 * @returns An `SSEInterceptor` with `kind: 'sse'`.
 */
export function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor {
  return { kind: 'sse', fn }
}

// ---------------------------------------------------------------------------
// WebSocket Interceptor
// ---------------------------------------------------------------------------

/**
 * Minimal WebSocket session surface used by interceptors.
 *
 * Structurally compatible with `WebSocketSession` without importing that type
 * (avoids a circular dependency between interceptors and WebSocket).
 */
export interface WebSocketSessionLike extends AsyncDisposable {
  readonly bufferedAmount: number
  readonly connection: { extensions?: string; generation: number; protocol?: string; url?: string }
  readonly closed: Promise<WebSocketCloseInfo>
  readonly receive: AsyncIterable<unknown>
  readonly state: WebSocketState
  close(code?: number, reason?: string): void
  [Symbol.asyncDispose](): PromiseLike<void>
  onRuntimeError(listener: (error: unknown) => void): () => void
  onStateChange(listener: (state: WebSocketState) => void): () => void
  send(message: unknown): void
}

/**
 * Terminal WebSocket handler that opens a session for the given request.
 */
export type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>

/**
 * WebSocket interceptor function: may inspect/modify the request, then call `next`.
 */
export type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>

/**
 * Tagged WebSocket interceptor for client option lists.
 */
export interface WebSocketInterceptor {
  kind: 'web-socket'
  fn: WebSocketInterceptorFn
}

/**
 * Wrap a `WebSocketInterceptorFn` as a tagged `WebSocketInterceptor`.
 *
 * @param fn - WebSocket interceptor function.
 * @returns A `WebSocketInterceptor` with `kind: 'web-socket'`.
 */
export function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor {
  return { kind: 'web-socket', fn }
}

// ---------------------------------------------------------------------------
// Unified type
// ---------------------------------------------------------------------------

/**
 * Any tagged interceptor accepted by client interceptor options.
 */
export type Interceptor = HttpInterceptor | SSEInterceptor | WebSocketInterceptor

// ---------------------------------------------------------------------------
// Chain builders
// ---------------------------------------------------------------------------

// Generic onion-chain builder — HTTP, SSE, and WebSocket chains share this shape.
type Handler<TReq, TResult> = (req: TReq) => TResult
type InterceptorChainFn<TReq, TResult> = (req: TReq, next: Handler<TReq, TResult>) => TResult

function dispatch<TReq, TResult>(req: TReq, next: Handler<TReq, TResult>): TResult {
  return next(req)
}

export function makeChain<TReq, TResult>(interceptors: InterceptorChainFn<TReq, TResult>[]): InterceptorChainFn<TReq, TResult> {
  return interceptors.reduceRight<InterceptorChainFn<TReq, TResult>>(
    (fn, interceptor) => (req, next) => interceptor(req, (nextReq) => fn(nextReq, next)),
    dispatch,
  )
}

// ---------------------------------------------------------------------------
// Resolvers – extract typed interceptor fns from the mixed array
// ---------------------------------------------------------------------------

export function resolveHttpInterceptors(interceptors: Interceptor[]): InterceptorFn[] {
  return interceptors.filter((i): i is HttpInterceptor => i.kind === 'http').map((i) => i.fn)
}

export function resolveSSEInterceptors(interceptors: Interceptor[]): SSEInterceptorFn[] {
  return interceptors.filter((i): i is SSEInterceptor => i.kind === 'sse').map((i) => i.fn)
}

export function resolveWebSocketInterceptors(interceptors: Interceptor[]): WebSocketInterceptorFn[] {
  return interceptors.filter((i): i is WebSocketInterceptor => i.kind === 'web-socket').map((i) => i.fn)
}
