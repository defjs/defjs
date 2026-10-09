---
title: OpenTelemetry server
description: Turn on outbound Defjs transport instrumentation with your own Tracer and optional Meter.
---

# OpenTelemetry server

Turn outbound instrumentation on when you create the client. `@defjs/opentelemetry-server` appends HTTP, SSE, and WebSocket interceptors. It is **not** inbound server instrumentation, and it does **not** initialize an OpenTelemetry SDK.

## Basic Setup

Initialize the SDK elsewhere. Pass its API objects in:

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { metrics, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const meter = metrics.getMeter('orders-service')
const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer, meter }))

const [error] = await client.execute(readOrders())
if (error) console.error(error.code)
```

`tracer` is required. `meter` is optional — omit it to disable package metrics. No `propagator` → the adapter builds a composite W3C Trace Context + W3C Baggage propagator. It does not read or initialize global SDK config for you.

`withOpenTelemetryServer(options)` returns a core `ClientOption`. Apply it at `createClient` time so one interceptor is appended per enabled transport. HTTP, SSE, and WebSocket are enabled by default; `{ enabled: false }` disables one transport.

The adapter can create transport telemetry even when the request fails at the transport layer. Whether anything is exported depends on your SDK and exporters.

## Scope

You own SDK init, providers, exporters, processors, context, sampling, redaction, flush, and shutdown. This package consumes the `Tracer`, optional `Meter`, and optional `TextMapPropagator` you pass in. It does not include a redactor or a sensitive-key policy.

No caching, retries, message-level spans, or application command-outcome policy. Intended for server-side Node.js. Published package needs Node.js 22+, peers `@defjs/core`, `@opentelemetry/api` 1.x, `@opentelemetry/core` 2.x.

Public API: `withOpenTelemetryServer` plus `OpenTelemetryServerOptions`, `OpenTelemetryServerHttpOptions`, `OpenTelemetryServerSSEOptions`, `OpenTelemetryServerWebSocketOptions`.

## Options and hooks

Hooks sit next to the transport they change. The synchronous `startSpanHook(request)` runs before span creation and returns initial `Attributes`; application attributes are applied last, so they may override built-in values. `requestHook` and `responseHook` receive the already-created span and may return `void` or a promise. A hook failure records `defjs.otel.hook.error` and does **not** stop the client operation; a failed start hook falls back to the built-in initial attributes.

```typescript twoslash
import { createClient, createResolvedRequestUrl, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    http: {
      startSpanHook(request) {
        const attributes = { 'app.operation': request.operation ?? 'unclassified' }
        if (!request.baseEndpoint) return attributes
        const url = createResolvedRequestUrl(request.baseEndpoint, request.endpoint)
        if (request.queryString) url.search = request.queryString
        url.searchParams.delete('access_token')
        return { ...attributes, 'url.full': url.href }
      },
      requestHook(span, request) {
        span.setAttribute('app.request.started', true)
      },
      responseHook(span, response) {
        span.setAttribute('app.status', response.status)
      },
    },
    sse: { enabled: false },
    webSocket: { enabled: false },
  }),
)

void client
```

Hook signatures:

- All three transports: `startSpanHook(request): Attributes` (synchronous, before span creation)
- HTTP: `requestHook(span, request)` and `responseHook(span, response, request)`
- SSE: `requestHook(span, request)` and `responseHook(span, stream, request)`
- WebSocket: `requestHook(span, request)` and `responseHook(span, session, request)`

An empty transport object enables that transport. Old boolean transport switches and old top-level hooks are rejected — use transport option objects and transport-scoped hooks.

## Operation identity and propagation

Set a static `operation` on `defineRequest`, `defineEventStream`, or `defineWebSocket` when the command has a stable identity. The adapter uses it in span names and as `defjs.operation`. It never derives identity from a resolved path, identifier, tenant, or query string:

```typescript twoslash
import { defineEventStream, defineRequest, defineWebSocket, struct } from '@defjs/core'

const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})
const orderEvents = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  operation: 'orders.watch',
  path: '/orders/events',
  events: { update: struct.object({ id: struct.number() }) },
})
const orderSocket = defineWebSocket({
  maxIncomingQueueSize: 100,
  operation: 'orders.connect',
  path: '/orders/socket',
  incoming: struct.object({ id: struct.number() }),
})

void readOrders
void orderEvents
void orderSocket
```

Span names become `GET orders.read`, `SSE orders.watch`, `WebSocket orders.connect`. Without `operation`, fallback is method / `SSE` / `WebSocket`, and `defjs.operation` is omitted.

HTTP and SSE inject propagated fields into request headers. Existing `Headers` instances are reused and mutated; otherwise a new `Headers` is created. WebSocket query propagation is **opt-in** (browsers can’t add arbitrary handshake headers):

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    webSocket: { queryPropagation: true },
  }),
)
```

With `queryPropagation`, propagator fields append to the connection query string. Review URL logging, proxy visibility, access logs, baggage, and retention first. `requireParentSpan: true` skips span creation, propagation, hooks, and metrics when there’s no active parent, then calls `next` unchanged.

## HTTP, SSE, and WebSocket semantics

The adapter measures transport lifetimes, not every stage of command interpretation.

- **HTTP** — span begins in the HTTP interceptor and ends when it gets the Defjs `HttpResponse`. The media-type check, representation read, and Struct decode all happen after. A later `RES_*` fault cannot update the ended transport span. Because the span lives inside the chain, a transport rejection is recorded with the exception class per OTel convention rather than with the fault code that execution later assigns.
- **SSE** — span stays open until `stream.closed` settles. Records `sse.connected`, then `sse.closed` / `sse.aborted` / `sse.error`. One logical stream (including reconnects) → one span. No per-event spans.
- **WebSocket** — span stays open until `session.closed` settles. Events: `websocket.connected`, `websocket.closed`, `websocket.error`. Reconnecting physical sockets stay part of the logical session. No per-message spans.

Need the final command result, not only transport? Wrap `client.execute(...)` in an application span:

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
const readOrders = defineRequest({ method: 'GET', operation: 'orders.read', path: '/orders' })

const outcome = await tracer.startActiveSpan('orders.command', async (span) => {
  try {
    const outcome = await client.execute(readOrders())
    const [error] = outcome
    if (error) {
      span.setAttribute('error.type', error.code)
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    return outcome
  } finally {
    span.end()
  }
})

void outcome
```

Outer span is yours. The plugin still reports the lower-level transport span — two different questions.

## Reference

When `meter` is supplied:

| Metric                                       | Meaning                                          |
| -------------------------------------------- | ------------------------------------------------ |
| `http.client.request.duration`               | HTTP request duration (seconds)                  |
| `defjs.client.sse.connect.duration`          | Time until SSE handle returned                   |
| `defjs.client.sse.connection.duration`       | Handle return → terminal close                   |
| `defjs.client.sse.active_streams`            | Logical SSE handles with pending `closed`        |
| `defjs.client.websocket.connect.duration`    | Time until WebSocket session returned            |
| `defjs.client.websocket.connection.duration` | Session return → terminal close                  |
| `defjs.client.websocket.active_connections`  | Logical WebSocket sessions with pending `closed` |

Active SSE/WebSocket instruments count logical resources (including reconnect gaps), not physical sockets or individual HTTP attempts.

HTTP spans record method, resolved `url.full`, server address/port when available, and response status when received. The default `url.full` resolves `request.endpoint` against optional `request.baseEndpoint`; it does not append an independent `request.queryString`. This is a construction boundary, not sanitization. Use `startSpanHook` to construct a complete or redacted application-owned URL when needed. Status `400+` → span status `ERROR` with status string as `error.type`. Status `100..399` leaves span status unset. Status-zero transport outcome has no response status; cancel leaves status unset; timeout/other transport failures use `NET_TIMEOUT` or `NET_UNREACHABLE`. Metrics use stable dimensions: method, static operation, server address/port, response status, low-cardinality error type.

SSE/WebSocket connection metrics record connect time, logical connection duration, active resource count, `defjs.result`, operation, server address/port, and low-cardinality failure types. No request/response bodies, message payloads, queue lengths, or per-message spans by default.

Treat `url.full` and `recordException(...)` as potentially sensitive. Defjs does not redact them for you. Keep operation names and hook attributes allowlisted; redact in `startSpanHook` or SDK processors/exporters. Don’t copy raw URLs, query strings, headers, baggage, or payloads into custom telemetry without reviewing privacy, cardinality, retention, and redaction.

WebSocket query propagation can expose trace context and baggage to browsers, proxies, access logs, and telemetry. It is not a credential channel. `withCredentials(true)` is Fetch credentials for HTTP/SSE — not WebSocket auth.

The adapter does not init/shut down the SDK, and does not dispose the core client or transport handles. You flush telemetry and close HTTP/SSE/WebSocket work. See [Interceptors](../core/interceptors.md), [SSE](../core/sse.md), and [WebSocket](../core/web-socket.md).

## Related recipes

- [Test with a local Fetch handle](../recipes/test-with-handle.md)
- [Consume an SSE stream](../recipes/consume-sse.md)
- [Open a WebSocket session](../recipes/websocket-session.md)
