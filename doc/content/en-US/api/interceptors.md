---
title: Interceptors
description: HTTP, SSE, and WebSocket interceptor constructors.
---

# Interceptors

Wrap `next` for one transport. Register with `withInterceptors`. Mixed lists are filtered by kind at execute time.

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

A wrapper or short-circuit session must forward the same `[Symbol.asyncDispose]()` teardown as its `close` / `closed` lifecycle; returning an unrelated resolved promise is not sufficient. Requiring this member is a compile-time breaking change for structural implementations. Code that only accepts sessions returned by Defjs has no additional runtime call requirement.

## Tagged types

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## Basic auth

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Sets `Authorization: Basic <encoded>` on each request. `fn` returns `{ username, password }` and is called per request. The optional second argument `{ encode }` receives that credential and returns the part after `Basic `; the default encodes ``btoa(`${username}:${password}`)``. Without `encode`, creating the interceptor throws when `btoa` is unavailable.

See [Interceptors guide](/docs/interceptors).
