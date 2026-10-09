---
title: Interceptors
description: Layer HTTP, SSE, and WebSocket policy at the transport boundary in onion order.
---

# Interceptors

Add auth headers, short-circuit maintenance windows, or retry safe reads — without touching command validation. Each transport has its own chain. You get an `HttpRequest` in; you return that transport’s result (`HttpResponse`, event-stream handle, or WebSocket session). Input validation runs before the chain; status dispatch and decoded results after.

## Basic Setup

```typescript twoslash
import { createClient, createHttpInterceptor, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit))
void client
```

## Onion order

`withInterceptors(...items)` accepts mixed interceptors. The client filters by `kind` for the selected transport and keeps relative registration order. Each interceptor may run before and after `next`:

| Factory                      | Request       | Result from `next`                    |
| ---------------------------- | ------------- | ------------------------------------- |
| `createHttpInterceptor`      | `HttpRequest` | `Promise<HttpResponse<unknown>>`      |
| `createSSEInterceptor`       | `HttpRequest` | `Promise<EventStreamHandle<unknown>>` |
| `createWebSocketInterceptor` | `HttpRequest` | `Promise<WebSocketSessionLike>`       |

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

const order: string[] = []
const first = createHttpInterceptor(async (request, next) => {
  order.push('first:before')
  const response = await next(request)
  order.push('first:after')
  return response
})

const second = createHttpInterceptor(async (request, next) => {
  order.push('second:before')
  const response = await next(request)
  order.push('second:after')
  return response
})

// Request: first:before → second:before → transport
// Return: second:after → first:after
void [first, second, order]
```

Multiple `withInterceptors(...)` calls append. Put broad observation outside narrower mutation/retry when the outer layer must see the final result.

## Clone and add request headers

Treat the incoming `HttpRequest` as owned by the chain. Clone `Headers` before changing them; pass a new request to `next`:

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

function readAccessToken(): string | undefined {
  return undefined
}

const bearer = createHttpInterceptor((request, next) => {
  const token = readAccessToken()
  if (!token) return next(request)

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return next({ ...request, headers })
})
```

Same pattern for SSE. Browser WebSocket can’t add arbitrary handshake headers — changing `request.headers` won’t authenticate a browser socket. Use protocol, URL/query policy, or a server-supported handshake instead.

When replacing an HTTP body, replace `body` on the copied request. Fetch ignores stale content-type metadata when the body value changed. Don’t reuse a consumed `ReadableStream` body.

## Short-circuit a request

You can skip `next`, but you must return the expected result type. For HTTP, `makeResponse(...)` builds a compatible wrapper:

```typescript twoslash
import { createHttpInterceptor, makeResponse } from '@defjs/core'

function isMaintenanceWindow(): boolean {
  return false
}

const maintenanceGate = createHttpInterceptor(async (_request, next) => {
  if (isMaintenanceWindow()) {
    return makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { message: 'Temporarily unavailable' },
    })
  }

  return next(_request)
})
```

The command layer still dispatches by status. Declare one `error` struct for the non-2xx side when callers need typed `error.data`. Short-circuiting SSE or WebSocket needs a complete compatible handle/session (closure promises, live state, ownership, and `[Symbol.asyncDispose]`). Partial objects aren’t valid policy. Structural `EventStreamHandle` and `WebSocketSessionLike` implementations now need that standard disposer at compile time; consumers that only receive Defjs handles have no new runtime call requirement.

## Retry safe reads

Retries change behavior. Keep the policy narrow — this example retries replayable `GET` / `HEAD` / `OPTIONS` for statuses `0`, `429`, `502`, `503`, `504`, caps `Retry-After` at 30s, and stops after two retries or on abort:

```typescript twoslash
import { createHttpInterceptor, type HttpRequest, type HttpResponse } from '@defjs/core'

const retryableMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const retryableStatuses = new Set([0, 429, 502, 503, 504])

function isReplayable(request: HttpRequest): boolean {
  return typeof ReadableStream === 'undefined' || !(request.body instanceof ReadableStream)
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get('retry-after')
  if (!value) return 250

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000)

  const date = Date.parse(value)
  return Number.isNaN(date) ? 250 : Math.min(Math.max(0, date - Date.now()), 30_000)
}

function waitForRetryAfter(response: HttpResponse<unknown>, signal?: AbortSignal): Promise<void> {
  const delay = retryAfterMs(response)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(done, delay)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason)
    }

    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (!retryableMethods.has(request.method.toUpperCase()) || !isReplayable(request)) return next(request)

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request)
    if (!retryableStatuses.has(response.status) || attempt >= 2) return response
    await waitForRetryAfter(response, request.abort)
  }
})
```

Thrown interceptor/Fetch errors aren’t retried by this loop — a transport failure rejects instead of producing a status this loop could match on. Retrying `POST` / `PUT` / `PATCH` / `DELETE` needs replayable bytes, server support, an idempotency contract, and a reviewed status policy. You own retry — Core does not export `retryAfter()`.

An interceptor that throws (or rejects) outside this sample is returned to the caller as
`EXT_INTERCEPTOR_FAILED`, with the thrown value on `cause` — see [Errors](./errors.md). Throwing
`ERR_ABORTED` or `ERR_TIMEOUT` is how an interceptor expresses cancellation instead.

`next(request)` can reject. A transport failure is a fault, not a status-0 response, so an
interceptor that wants to observe one uses `try` / `catch` around `next`. Defjs still attributes it
correctly: a rejection that came from the transport stays a `NET_*` fault rather than being blamed
on your interceptor.

## Wrap WebSocket sessions

A WebSocket interceptor may call `next` at most once. If you wrap the session, delegate live getters and lifecycle members explicitly:

```typescript twoslash
import { createWebSocketInterceptor } from '@defjs/core'

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request)

  return {
    get bufferedAmount() {
      return session.bufferedAmount
    },
    get connection() {
      return session.connection
    },
    get state() {
      return session.state
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason)
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]()
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener)
    },
    onStateChange(listener) {
      return session.onStateChange(listener)
    },
    send(message: unknown) {
      session.send(message)
    },
  }
})
```

Spreading a session snapshots `state` / `connection` / `bufferedAmount` once. Preserve `closed`, `receive`, `close`, the exact `[Symbol.asyncDispose]()` delegation, and listener cleanup unless you’re deliberately changing ownership. A wrapper must return the inner session’s teardown promise, not an unrelated resolved promise. If a chain creates a session that isn’t delivered, Core settles and closes it; if a successful interceptor returns a different session, Core discards the created one.

## Reference

Factories return tagged transport values:

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — Basic credentials on HTTP
- `basicAuthSSEInterceptor(provider, options?)` — Basic credentials on SSE

`HttpRequest` may include `endpoint`, `baseEndpoint`, `method`, `headers`, `body`, `queryParams`, `queryString`, `abort`, `timeout`, and static `operation`. It’s a transport integration value — not the caller’s parsed input. `queryParams` is `new URLSearchParams(queryString)` after serialization. A configured query serializer is not called when the builder produced no query, and a builder `URLSearchParams` is used as-is. Keep command validation, output validation, and domain error mapping in their layers.

SSE/WebSocket observers are lifecycle hooks, not control flow. Unsubscribe WebSocket listeners when the owner ends. Observer failures follow the transport contract; an interceptor itself can throw or reject.

Log a reviewed allowlist: static `operation`, method, status, duration, stable error code. Don’t log resolved URLs, query strings, auth headers, bodies, raw causes, SSE event IDs, or WebSocket payloads by default.

Basic credentials are base64, not encrypted. Use TLS, keep credential providers request-scoped on a server, never log the generated header. Default encoder is `globalThis.btoa`; pass `BasicAuthInterceptorOptions.encode` when the runtime lacks `btoa` or needs a reviewed encoder.

An interceptor can enforce transport policy. It is not input validation, authorization, or resource ownership. The code that starts long-lived work still uses `await using` or manually closes and awaits the terminal promise. Ordinary HTTP remains request-scoped and is managed with its timeout / `AbortSignal`; `Client` is not `AsyncDisposable`.

## Related recipes

- [Refresh a Bearer token once on 401](../recipes/refresh-bearer-once.md)
- [Publish an HTTP SDK without hiding execute](../recipes/publish-http-sdk.md)
- [Test with a local Fetch handle](../recipes/test-with-handle.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
