import type { HttpRequest } from "../internal/http_request";
import type { HttpResponse } from "../internal/http_response";
import type { EventStreamHandle } from "../sse/transport/event_stream";
import type {
  WebSocketCloseInfo,
  WebSocketState,
} from "../web_socket/web_socket";

// ---------------------------------------------------------------------------
// HTTP Interceptor
// ---------------------------------------------------------------------------

/**
 * Continuation that runs the rest of the HTTP interceptor chain, or the handler.
 *
 * `next(req)` only goes inward: the interceptors registered after this one, then
 * the Fetch handler. It is not a re-dispatch of `client.execute` from the
 * outside of the chain. Call `next` again for a safe
 * replay (for example one 401 refresh) from the same interceptor; outer layers
 * do not run a second time. Once the chain has settled, calling `next` rejects
 * with `HTTP interceptor next() cannot be called after the chain has settled`.
 *
 * @group interceptors
 */
export type HttpInterceptorNext = (
  req: HttpRequest,
) => Promise<HttpResponse<unknown>>;

/**
 * HTTP interceptor function: may inspect or modify the request, then call `next`.
 *
 * Call `next(req)` or short-circuit with `makeResponse`. Wrap it with
 * `createHttpInterceptor` to register it.
 *
 * @group interceptors
 */
export type InterceptorFn = (
  req: HttpRequest,
  next: HttpInterceptorNext,
) => Promise<HttpResponse<unknown>>;

/**
 * Tagged HTTP interceptor accepted by client interceptor options.
 *
 * Created by `createHttpInterceptor`. `kind` is the discriminant that lets
 * `withInterceptors` accept HTTP, SSE, and WebSocket interceptors in one list.
 *
 * @group interceptors
 */
export interface HttpInterceptor {
  kind: "http";
  fn: InterceptorFn;
}

/**
 * Wraps an `InterceptorFn` as a tagged `HttpInterceptor`.
 *
 * Returns `{ kind: 'http', fn }`. Call `next(req)` (optionally with a modified
 * request) or short-circuit with `makeResponse`. `next` runs only the
 * interceptors registered after this one and then the fetch handler. HTTP
 * interceptors do not run for SSE or WebSocket commands.
 *
 * A deterministic URL error from `next(req)` rejects the returned promise, so
 * `.then` or `.catch` recovery runs; if it is not recovered, `client.execute`
 * still reports `REQ_BUILD_FAILED`.
 *
 * @param fn - HTTP interceptor function.
 * @returns An `HttpInterceptor` with `kind: 'http'`.
 * @group interceptors
 */
export function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor {
  return { kind: "http", fn };
}

// ---------------------------------------------------------------------------
// SSE Interceptor
// ---------------------------------------------------------------------------

/**
 * Terminal `next` function an SSE interceptor receives; it opens an event stream for the request.
 *
 * `next(req)` goes inward only: through the interceptors registered after this
 * one, then the transport that opens the stream. Calling it after the chain has
 * settled rejects.
 *
 * `EventStreamHandle` extends `AsyncDisposable`. A short-circuit implementation
 * that builds its own handle must provide
 * `[Symbol.asyncDispose](): PromiseLike<void>` and connect it to the same close
 * lifecycle.
 *
 * @group interceptors
 */
export type SSEHandler = (
  req: HttpRequest,
) => Promise<EventStreamHandle<unknown>>;

/**
 * SSE interceptor function: may inspect, modify, or replace the request, then call `next`.
 *
 * Call `next` (an {@link SSEHandler}) to continue the chain, or return your own
 * `EventStreamHandle` to short-circuit. Wrap it with `createSSEInterceptor` to
 * register it through `withInterceptors`.
 *
 * A short-circuit handle must provide
 * `[Symbol.asyncDispose](): PromiseLike<void>` and connect it to the same close
 * lifecycle.
 *
 * @group interceptors
 */
export type SSEInterceptorFn = (
  req: HttpRequest,
  next: SSEHandler,
) => Promise<EventStreamHandle<unknown>>;

/**
 * Tagged SSE interceptor for client option lists, accepted by `withInterceptors`.
 *
 * Created by `createSSEInterceptor`. The `kind` tag lets `withInterceptors`
 * accept HTTP, SSE, and WebSocket interceptors in one list; only `kind: 'sse'`
 * interceptors run for SSE commands.
 *
 * @group interceptors
 */
export interface SSEInterceptor {
  kind: "sse";
  fn: SSEInterceptorFn;
}

/**
 * Wraps an `SSEInterceptorFn` as a tagged `SSEInterceptor`.
 *
 * Returns `{ kind: 'sse', fn }`. SSE interceptors run only for SSE commands, in
 * registration order; `next(req)` opens the stream through the remaining
 * interceptors.
 *
 * A deterministic URL error from `next(req)` rejects the returned promise, so
 * `.then` or `.catch` recovery runs; if it is not recovered, `client.execute`
 * still reports `REQ_BUILD_FAILED`.
 *
 * `EventStreamHandle` extends `AsyncDisposable`. A structural short-circuit
 * implementation must provide `[Symbol.asyncDispose](): PromiseLike<void>` and
 * connect it to the same close lifecycle.
 *
 * @param fn - SSE interceptor function.
 * @returns An `SSEInterceptor` with `kind: 'sse'`.
 * @group interceptors
 */
export function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor {
  return { kind: "sse", fn };
}

// ---------------------------------------------------------------------------
// WebSocket Interceptor
// ---------------------------------------------------------------------------

/**
 * Minimal WebSocket session surface that interceptors see.
 *
 * Structurally compatible with {@link WebSocketSession} without importing that
 * type, which avoids a circular dependency between interceptors and WebSocket.
 * Messages are typed `unknown`.
 *
 * A wrapper or short-circuit session must forward the same
 * `[Symbol.asyncDispose]()` teardown as its `close` / `closed` lifecycle;
 * returning an unrelated resolved promise is not sufficient. Requiring this
 * member is a compile-time breaking change for structural implementations. Code
 * that only accepts sessions returned by Defjs has no additional runtime call
 * requirement.
 *
 * @group interceptors
 */
export interface WebSocketSessionLike extends AsyncDisposable {
  readonly bufferedAmount: number;
  readonly connection: {
    extensions?: string;
    generation: number;
    protocol?: string;
    url?: string;
  };
  readonly closed: Promise<WebSocketCloseInfo>;
  readonly receive: AsyncIterable<unknown>;
  readonly state: WebSocketState;
  close(code?: number, reason?: string): void;
  [Symbol.asyncDispose](): PromiseLike<void>;
  onRuntimeError(listener: (error: unknown) => void): () => void;
  onStateChange(listener: (state: WebSocketState) => void): () => void;
  send(message: unknown): void;
}

/**
 * Terminal `next` function a WebSocket interceptor receives; it opens a session for the request.
 *
 * `next(req)` goes inward only: through the interceptors registered after this
 * one, then the transport that opens the session. It resolves to a
 * {@link WebSocketSessionLike}. It may be called once per execute; a second
 * call, or a call after the chain has settled, rejects.
 *
 * @group interceptors
 */
export type WebSocketHandler = (
  req: HttpRequest,
) => Promise<WebSocketSessionLike>;

/**
 * WebSocket interceptor function: may inspect, modify, or replace the request, then call `next`.
 *
 * Call `next` (a {@link WebSocketHandler}) to continue the chain, or return your own
 * {@link WebSocketSessionLike} to short-circuit. Wrap it with
 * `createWebSocketInterceptor` to register it through `withInterceptors`.
 *
 * The chain runs once per `execute`. Reconnects happen inside the session it
 * returns and do not run it again.
 *
 * @group interceptors
 */
export type WebSocketInterceptorFn = (
  req: HttpRequest,
  next: WebSocketHandler,
) => Promise<WebSocketSessionLike>;

/**
 * Tagged WebSocket interceptor for client option lists, accepted by `withInterceptors`.
 *
 * Created by `createWebSocketInterceptor`. The `kind` tag lets
 * `withInterceptors` accept HTTP, SSE, and WebSocket interceptors in one list;
 * only `kind: 'web-socket'` interceptors run for WebSocket commands.
 *
 * @group interceptors
 */
export interface WebSocketInterceptor {
  kind: "web-socket";
  fn: WebSocketInterceptorFn;
}

/**
 * Wraps a `WebSocketInterceptorFn` as a tagged `WebSocketInterceptor`.
 *
 * Returns `{ kind: 'web-socket', fn }`. WebSocket interceptors run only for
 * WebSocket commands. `next` and the interceptor return a
 * {@link WebSocketSessionLike}, the interceptor-facing session. A wrapper or
 * short-circuit session must forward its `[Symbol.asyncDispose]()` teardown.
 *
 * @param fn - WebSocket interceptor function.
 * @returns A `WebSocketInterceptor` with `kind: 'web-socket'`.
 * @group interceptors
 */
export function createWebSocketInterceptor(
  fn: WebSocketInterceptorFn,
): WebSocketInterceptor {
  return { kind: "web-socket", fn };
}

// ---------------------------------------------------------------------------
// Unified type
// ---------------------------------------------------------------------------

/**
 * Any tagged interceptor accepted by client interceptor options.
 *
 * `kind` (`'http'`, `'sse'`, or `'web-socket'`) selects which commands an
 * interceptor runs for. `withInterceptors` accepts any mix; each transport runs
 * only its own kind, in registration order.
 *
 * @group interceptors
 */
export type Interceptor =
  HttpInterceptor | SSEInterceptor | WebSocketInterceptor;

// ---------------------------------------------------------------------------
// Chain builders
// ---------------------------------------------------------------------------

// Generic onion-chain builder — HTTP, SSE, and WebSocket chains share this shape.
type Handler<TReq, TResult> = (req: TReq) => TResult;
type InterceptorChainFn<TReq, TResult> = (
  req: TReq,
  next: Handler<TReq, TResult>,
) => TResult;

function dispatch<TReq, TResult>(
  req: TReq,
  next: Handler<TReq, TResult>,
): TResult {
  return next(req);
}

export function makeChain<TReq, TResult>(
  interceptors: InterceptorChainFn<TReq, TResult>[],
): InterceptorChainFn<TReq, TResult> {
  return interceptors.reduceRight<InterceptorChainFn<TReq, TResult>>(
    (fn, interceptor) => (req, next) =>
      interceptor(req, (nextReq) => fn(nextReq, next)),
    dispatch,
  );
}

// ---------------------------------------------------------------------------
// Resolvers – extract typed interceptor fns from the mixed array
// ---------------------------------------------------------------------------

export function resolveHttpInterceptors(
  interceptors: Interceptor[],
): InterceptorFn[] {
  return interceptors
    .filter((i): i is HttpInterceptor => i.kind === "http")
    .map((i) => i.fn);
}

export function resolveSSEInterceptors(
  interceptors: Interceptor[],
): SSEInterceptorFn[] {
  return interceptors
    .filter((i): i is SSEInterceptor => i.kind === "sse")
    .map((i) => i.fn);
}

export function resolveWebSocketInterceptors(
  interceptors: Interceptor[],
): WebSocketInterceptorFn[] {
  return interceptors
    .filter((i): i is WebSocketInterceptor => i.kind === "web-socket")
    .map((i) => i.fn);
}
