import type { AnyFault } from "../error/types";
import type { HttpRequest } from "../http/http_request";
import type { HttpResponse } from "../http/http_response";
import type { EventStreamHandle } from "../sse/transport/event_stream";
import type { WebSocketSession } from "../web_socket/web_socket";

// ---------------------------------------------------------------------------
// HTTP Interceptor
// ---------------------------------------------------------------------------

/**
 * Continuation that runs the rest of the HTTP interceptor chain, or the handler.
 *
 * `next(req)` only goes inward: the interceptors registered after this one, then
 * the Fetch handler. It is not a new operation call from outside the chain.
 * Call `next` again for a safe
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
 * `withInterceptors` accept every interceptor kind in one list; only `kind: 'http'`
 * interceptors run for HTTP operations.
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
 * interceptors do not run for SSE or WebSocket operations.
 *
 * A deterministic URL error from `next(req)` rejects the returned promise, so
 * `.then` or `.catch` recovery runs; if it is not recovered, the operation
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
 * accept every interceptor kind in one list; only `kind: 'sse'`
 * interceptors run for SSE operations.
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
 * Returns `{ kind: 'sse', fn }`. SSE interceptors run only for SSE operations, in
 * registration order; `next(req)` opens the stream through the remaining
 * interceptors.
 *
 * A deterministic URL error from `next(req)` rejects the returned promise, so
 * `.then` or `.catch` recovery runs; if it is not recovered, the operation
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
 * WebSocket session surface that interceptors see: a {@link WebSocketSession} whose messages are typed `unknown`.
 *
 * A wrapper or short-circuit session must forward the same
 * `[Symbol.asyncDispose]()` teardown as its `close` / `closed` lifecycle;
 * returning an unrelated resolved promise is not sufficient.
 *
 * @group interceptors
 */
/* eslint-disable @typescript-eslint/no-empty-object-type -- an interface, not a type alias, keeps the name WebSocketSessionLike in declarations, hovers and the generated API pages */
export interface WebSocketSessionLike extends WebSocketSession<
  unknown,
  unknown
> {}
/* eslint-enable @typescript-eslint/no-empty-object-type */

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
 * The chain runs once per operation. Reconnects happen inside the session it
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
 * `withInterceptors` accept every interceptor kind in one list;
 * only `kind: 'web-socket'` interceptors run for WebSocket operations.
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
 * WebSocket operations. `next` and the interceptor return a
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
// Operation Interceptor
// ---------------------------------------------------------------------------

/**
 * The operation call an operation interceptor wraps, described by its definition.
 *
 * `transport` is `'http'`, `'sse'`, or `'websocket'`. `method` is the defined method; a WebSocket operation reports
 * `GET`, the method of its opening handshake. `path` is the defined path template, such as `/orders/:id`, before any
 * input is placed. `meta` is the definition's `meta`, the same read-only object every call shares. The input, the
 * request options, and the request itself are not part of it: the call has not been built when the interceptor runs.
 *
 * Each definition reuses one record for all of its calls.
 *
 * @group interceptors
 */
export interface OperationCall {
  readonly transport: "http" | "sse" | "websocket";
  readonly method: string;
  readonly path: string;
  readonly meta: { readonly [key: string]: unknown } | undefined;
}

/**
 * The error-first tuple any operation resolves with, as an operation interceptor reads it.
 *
 * Its first element is the fault, or `null` on success. The rest is the operation's own result: the data and response
 * for HTTP, the stream and its open information for SSE, the session and its connection for WebSocket.
 *
 * @group interceptors
 */
export type OperationResult = readonly [
  err: AnyFault | null,
  ...rest: unknown[],
];

/**
 * Operation interceptor function: observes one operation call from its start to the tuple it resolves with.
 *
 * `next()` runs the whole call: input validation, the endpoint pick, the builder, every attempt with its interceptor
 * chain and retries, and the response decoding. It takes no arguments, so the interceptor cannot change the call. A
 * second call of `next()` returns the same promise and does not run the call again. The function is generic in the
 * result, so it can only resolve with what `next()` resolved with.
 *
 * Code that the function runs inside `next()`, such as an OpenTelemetry `context.with`, is in effect for the whole
 * call, including the transport interceptors. `next()` never rejects. If the function throws or rejects, its layer
 * resolves with `EXT_INTERCEPTOR_FAILED` and the thrown value as `cause`: that is what the operation resolves with,
 * and what `next()` resolves with in the operation interceptors registered before it. A stream or session the call
 * had already opened is closed with that value.
 *
 * @group interceptors
 */
export type OperationInterceptorFn = <TResult extends OperationResult>(
  call: OperationCall,
  next: () => Promise<TResult>,
) => Promise<TResult>;

/**
 * Tagged operation interceptor accepted by client interceptor options.
 *
 * Created by `createOperationInterceptor`. Operation interceptors run for every HTTP, SSE, and WebSocket operation, in
 * registration order, outside the transport interceptors.
 *
 * @group interceptors
 */
export interface OperationInterceptor {
  kind: "operation";
  fn: OperationInterceptorFn;
}

/**
 * Wraps an `OperationInterceptorFn` as a tagged `OperationInterceptor`.
 *
 * Returns `{ kind: 'operation', fn }`. An operation interceptor sees each operation call once, from the moment it is
 * called until it resolves its error-first tuple, so it observes what the transport interceptors cannot: an input
 * that fails validation (`REQ_INPUT_INVALID`), a builder or endpoint failure before any request exists
 * (`REQ_BUILD_FAILED`), the retries of one call, and a response that fails decoding after the transport chain
 * returned it (`HTTP_STATUS`, `RES_*`). For SSE and WebSocket the call resolves once the stream or session is open;
 * what happens on it later is observed through its `closed`.
 *
 * It observes; it does not alter the call. Use a transport interceptor to change requests or responses.
 *
 * @param fn - Operation interceptor function.
 * @returns An `OperationInterceptor` with `kind: 'operation'`.
 * @group interceptors
 * @exampleFile examples/api/create-operation-interceptor.ts#example
 */
export function createOperationInterceptor(
  fn: OperationInterceptorFn,
): OperationInterceptor {
  return { kind: "operation", fn };
}

// ---------------------------------------------------------------------------
// Unified type
// ---------------------------------------------------------------------------

/**
 * Any tagged interceptor accepted by client interceptor options.
 *
 * `kind` (`'http'`, `'sse'`, `'web-socket'`, or `'operation'`) selects which operations an
 * interceptor runs for. `withInterceptors` accepts any mix; each transport runs
 * only its own kind, in registration order, and every operation runs the `'operation'` kind around it.
 *
 * @group interceptors
 */
export type Interceptor =
  | HttpInterceptor
  | SSEInterceptor
  | WebSocketInterceptor
  | OperationInterceptor;

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
