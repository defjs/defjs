---
title: OpenTelemetry Server
description: Ausgehende Defjs-Transport-Instrumentierung mit deinem eigenen Tracer und optionalem Meter einschalten.
---

# OpenTelemetry Server

Schalte ausgehende Instrumentierung ein, wenn du den Client erzeugst. `@defjs/opentelemetry-server` hängt HTTP-, SSE- und WebSocket-Interceptor an. Es ist **keine** inbound Server-Instrumentierung und initialisiert **kein** OpenTelemetry-SDK.

## Basic Setup

Initialisiere das SDK woanders. Gib seine API-Objects rein:

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

`tracer` ist required. `meter` ist optional — lass ihn weg, um Package-Metrics zu disablen. Kein `propagator` → der Adapter baut einen Composite W3C Trace Context + W3C Baggage Propagator. Er liest oder initialisiert keine globale SDK-Config für dich.

`withOpenTelemetryServer(options)` gibt eine Core-`ClientOption` zurück. Apply sie bei `createClient`, damit ein Interceptor pro enabled Transport angehängt wird. HTTP, SSE und WebSocket sind default enabled; `{ enabled: false }` disabled einen Transport.

Der Adapter kann Transport-Telemetry erzeugen, auch wenn der Request an der Transport-Layer failt. Ob etwas exportiert wird, hängt von deinem SDK und deinen Exporters ab.

## Scope

Du besitzt SDK-Init, Provider, Exporter, Processor, Context, Sampling, Redaction, Flush und Shutdown. Dieses Paket konsumiert den `Tracer`, optionalen `Meter` und optionalen `TextMapPropagator`, die du übergibst. Es enthält keinen Redactor und keine Sensitive-Key-Policy.

Kein Caching, keine Retries, keine Message-Level-Spans, keine Application-Command-Outcome-Policy. Intended für server-side Node.js. Published Package braucht Node.js 22+, Peers `@defjs/core`, `@opentelemetry/api` 1.x, `@opentelemetry/core` 2.x.

Public API: `withOpenTelemetryServer` plus `OpenTelemetryServerOptions`, `OpenTelemetryServerHttpOptions`, `OpenTelemetryServerSSEOptions`, `OpenTelemetryServerWebSocketOptions`.

## Options und Hooks

Hooks sitzen neben dem Transport, den sie ändern. Das synchrone `startSpanHook(request)` läuft vor der Span-Erzeugung und liefert initiale `Attributes`; App-Attribute werden zuletzt angewandt und dürfen Built-ins überschreiben. `requestHook` und `responseHook` erhalten den bereits erzeugten Span und dürfen `void` oder ein Promise liefern. Jeder Hook-Fehler recordet `defjs.otel.hook.error` und stoppt die Operation nicht; ein fehlgeschlagener Start-Hook fällt auf Built-in-Attribute zurück.

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

Hook-Signatures:

- Alle drei Transports: `startSpanHook(request): Attributes` (synchron, vor Span-Erzeugung)
- HTTP: `requestHook(span, request)` und `responseHook(span, response, request)`
- SSE: `requestHook(span, request)` und `responseHook(span, stream, request)`
- WebSocket: `requestHook(span, request)` und `responseHook(span, session, request)`

Ein leeres Transport-Object enabled diesen Transport. Alte Boolean-Transport-Switches und alte Top-Level-Hooks werden rejected — nutze Transport-Option-Objects und transport-scoped Hooks.

## Operation-Identity und Propagation

Setze eine static `operation` auf `defineRequest`, `defineEventStream` oder `defineWebSocket`, wenn der Command eine stabile Identity hat. Der Adapter nutzt sie in Span-Namen und als `defjs.operation`. Er leitet Identity nie von resolved Path, Identifier, Tenant oder Query String ab:

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

Span-Namen werden `GET orders.read`, `SSE orders.watch`, `WebSocket orders.connect`. Ohne `operation` ist Fallback Method / `SSE` / `WebSocket`, und `defjs.operation` fehlt.

HTTP und SSE injecten propagated Fields in Request-Headers. Bestehende `Headers`-Instanzen werden reused und mutiert; sonst wird ein neues `Headers` erzeugt. WebSocket-Query-Propagation ist **opt-in** (Browser können keine beliebigen Handshake-Headers hinzufügen):

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

Mit `queryPropagation` hängen Propagator-Fields an den Connection-Query-String. Review URL-Logging, Proxy-Visibility, Access-Logs, Baggage und Retention zuerst. `requireParentSpan: true` skippt Span-Creation, Propagation, Hooks und Metrics, wenn kein active Parent da ist, und ruft dann `next` unverändert.

## HTTP-, SSE- und WebSocket-Semantics

Der Adapter misst Transport-Lifetimes, nicht jede Stage der Command-Interpretation.

- **HTTP** — der Span beginnt im HTTP-Interceptor und endet, sobald er die Defjs-`HttpResponse` bekommt. Media-Type-Prüfung, Representation-Read und Struct-Decode passieren alle danach, ein späterer `RES_*`-Fault kann den beendeten Transport-Span also nicht mehr aktualisieren. Und weil der Span innerhalb der Chain lebt, wird ein Transport-Rejection gemäß OTel-Konvention mit der Exception-Klasse festgehalten und nicht mit dem Fault-Code, den die Execution später zuweist.
- **SSE** — Span bleibt offen, bis `stream.closed` settled. Recordet `sse.connected`, dann `sse.closed` / `sse.aborted` / `sse.error`. Ein logischer Stream (inklusive Reconnects) → ein Span. Keine Per-Event-Spans.
- **WebSocket** — Span bleibt offen, bis `session.closed` settled. Events: `websocket.connected`, `websocket.closed`, `websocket.error`. Reconnecting physische Sockets bleiben Teil der logischen Session. Keine Per-Message-Spans.

Brauchst du das finale Command-Result, nicht nur Transport? Wrappe `client.execute(...)` in einen Application-Span:

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

Outer Span ist deiner. Das Plugin reportet weiterhin den niedrigeren Transport-Span — zwei verschiedene Fragen.

## Reference

Wenn `meter` geliefert wird:

| Metric                                       | Meaning                                          |
| -------------------------------------------- | ------------------------------------------------ |
| `http.client.request.duration`               | HTTP-Request-Duration (Seconds)                  |
| `defjs.client.sse.connect.duration`          | Zeit bis SSE-Handle returned                     |
| `defjs.client.sse.connection.duration`       | Handle-Return → Terminal-Close                   |
| `defjs.client.sse.active_streams`            | Logische SSE-Handles mit pending `closed`        |
| `defjs.client.websocket.connect.duration`    | Zeit bis WebSocket-Session returned              |
| `defjs.client.websocket.connection.duration` | Session-Return → Terminal-Close                  |
| `defjs.client.websocket.active_connections`  | Logische WebSocket-Sessions mit pending `closed` |

Active SSE-/WebSocket-Instruments zählen logische Resources (inklusive Reconnect-Gaps), nicht physische Sockets oder einzelne HTTP-Attempts.

HTTP-Spans recorden Method, resolved `url.full`, Server-Address/Port wenn verfügbar, und Response-Status wenn received. Standardmäßig löst `url.full` nur `request.endpoint` gegen das optionale `request.baseEndpoint` auf und hängt kein separates `request.queryString` an. Das ist eine Konstruktionsgrenze, keine Redaction; erzeuge eine vollständige oder redigierte App-URL in `startSpanHook`. Status `400+` → Span-Status `ERROR` mit Status-String als `error.type`. Status `100..399` lässt Span-Status unset. Status-Zero-Transport-Outcome hat keinen Response-Status; Cancel lässt Status unset; Timeout/andere Transport-Failures nutzen `NET_TIMEOUT` oder `NET_UNREACHABLE`. Metrics nutzen stabile Dimensions: Method, static Operation, Server-Address/Port, Response-Status, low-cardinality Error-Type.

SSE-/WebSocket-Connection-Metrics recorden Connect-Time, logische Connection-Duration, Active-Resource-Count, `defjs.result`, Operation, Server-Address/Port und low-cardinality Failure-Types. Keine Request-/Response-Bodies, Message-Payloads, Queue-Lengths oder Per-Message-Spans defaultmäßig.

Behandle `url.full` und `recordException(...)` als potenziell sensitiv. Defjs redigiert sie nicht für dich. Halte Operation-Namen und Hook-Attributes allowlisted; redact in `startSpanHook` oder SDK-Processors/Exporters. Kopiere Raw URLs, Query Strings, Headers, Baggage oder Payloads nicht in Custom Telemetry, ohne Privacy, Cardinality, Retention und Redaction zu reviewen.

WebSocket-Query-Propagation kann Trace-Context und Baggage an Browser, Proxies, Access-Logs und Telemetry exponieren. Es ist kein Credential-Kanal. `withCredentials(true)` ist Fetch-Credentials für HTTP/SSE — nicht WebSocket-Auth.

Der Adapter init/shut down das SDK nicht und disposet weder den Core-Client noch Transport-Handles. Du flushst Telemetry und schließt HTTP-/SSE-/WebSocket-Arbeit. Siehe [Interceptors](../core/interceptors.md), [SSE](../core/sse.md) und [WebSocket](../core/web-socket.md).

## Verwandte Rezepte

- [Mit lokalem Fetch-Handle testen](../recipes/test-with-handle.md)
- [SSE-Stream konsumieren](../recipes/consume-sse.md)
- [WebSocket-Session öffnen](../recipes/websocket-session.md)
