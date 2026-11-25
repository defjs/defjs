---
title: Interceptors
description: HTTP, SSE, and WebSocket interceptor constructors.
---

# Interceptors

Wrap `next` for one transport, or for a whole operation call. Register with `withInterceptors`. Mixed lists are filtered by kind when the operation runs.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Call `next(req)` (optionally a mutated request) or short-circuit with `makeResponse`. `next` only goes inward: to interceptors registered after this one, then the transport. Calling it again replays that inner part from this interceptor; outer interceptors do not run twice.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` extends `AsyncDisposable`. A structural short-circuit implementation must provide `[Symbol.asyncDispose](): PromiseLike<void>` and connect it to the same close lifecycle.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` is the interceptor-facing session:

<ApiSignature name="WebSocketSessionLike" />

A wrapper or short-circuit session must forward the same `[Symbol.asyncDispose]()` teardown as its `close` / `closed` lifecycle; returning an unrelated resolved promise is not sufficient.

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` runs the whole call: input validation, the endpoint pick, the builder, every attempt with its transport interceptors and retries, and the response decoding. It takes no arguments and runs the call once, however often it is called. The function is generic in the result, so it resolves only with what `next()` resolved with. Operation interceptors run for every transport, outside the transport interceptors. A throw or rejection resolves the operation with `EXT_INTERCEPTOR_FAILED`, and a stream or session the call had already opened is closed.

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## Tagged types

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## Basic auth

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Sets `Authorization: Basic <encoded>` on each request. `fn` returns `{ username, password }` and is called per request. The optional second argument `{ encode }` receives that credential and returns the part after `Basic `; the default encodes ``btoa(`${username}:${password}`)``. Without `encode`, creating the interceptor throws when `btoa` is unavailable.

## Concurrency limit

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

Limits concurrent in-flight HTTP attempts per bucket (`key`, defaulting to one shared bucket). Requests beyond `maxConcurrency` wait in FIFO order up to `maxQueue` (default `Infinity`), or reject with `BulkheadOverflowError` (surfaced as `EXT_INTERCEPTOR_FAILED` with `{ attempted: false }`). Permits are released during `withRetry` backoff waits, and pre-aborted or mid-queue aborted requests resolve with `NET_ABORTED` or `NET_TIMEOUT`. See [Concurrency limits & pooled calls](/recipes/concurrency-limit).

## Idempotency key

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

Clones `req.headers` and sets `headerName` (default `'Idempotency-Key'`) on requests whose method matches `methods` (default `['POST', 'PATCH']`), skipping requests that already carry the header when `respectExisting` is `true` (default). Without `generate`, reuses `req.correlationId` (or falls back to a v4 UUID) so every `withRetry` attempt of one call sends the same key; with `generate`, memoizes by `req.correlationId` in a bounded 4,096-entry cache. See [Idempotency keys](/recipes/idempotency-key).

See [Interceptors guide](/docs/interceptors).
