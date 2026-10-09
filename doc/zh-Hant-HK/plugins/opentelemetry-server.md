---
title: OpenTelemetry server
description: 用你自己嘅 Tracer 同 optional Meter，開 outbound Defjs transport instrumentation。
---

# OpenTelemetry server

Create client 時開 outbound instrumentation。`@defjs/opentelemetry-server` 會 append HTTP、SSE 同 WebSocket interceptors。佢 **唔係** inbound server instrumentation，亦 **唔會** initialize OpenTelemetry SDK。

## Basic Setup

喺其他地方 initialize SDK。將佢嘅 API objects 傳入嚟：

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

`tracer` 必填。`meter` 可選 — omit 就 disable package metrics。冇 `propagator` → adapter 會 build composite W3C Trace Context + W3C Baggage propagator。佢唔會代你讀或者 initialize global SDK config。

`withOpenTelemetryServer(options)` return core `ClientOption`。喺 `createClient` 時 apply，等每個 enabled transport append 一個 interceptor。HTTP、SSE 同 WebSocket 預設開；`{ enabled: false }` 關閉其中一個 transport。

即使 request 喺 transport layer fail，adapter 都可以 create transport telemetry。有冇嘢 export 就睇你嘅 SDK 同 exporters。

## Scope

SDK init、providers、exporters、processors、context、sampling、redaction、flush 同 shutdown 係你 own。呢個 package consume 你傳入嘅 `Tracer`、optional `Meter`，同 optional `TextMapPropagator`。佢冇 built-in redactor 或 sensitive-key policy。

冇 caching、retries、message-level spans，或者 application command-outcome policy。設計畀 server-side Node.js。Published package 要 Node.js 22+，peers `@defjs/core`、`@opentelemetry/api` 1.x、`@opentelemetry/core` 2.x。

Public API：`withOpenTelemetryServer` 再加 `OpenTelemetryServerOptions`、`OpenTelemetryServerHttpOptions`、`OpenTelemetryServerSSEOptions`、`OpenTelemetryServerWebSocketOptions`。

## Options 同 hooks

Hooks 坐喺佢哋改嘅 transport 旁邊。同步 `startSpanHook(request)` 會喺 create span 之前 run，再 return initial `Attributes`；application attributes 最後 apply，所以可以 override built-in values。`requestHook` 同 `responseHook` 收到已經 create 嘅 span，可以 return `void` 或 promise。Hook failure 會 record `defjs.otel.hook.error`，而且 **唔會** 停 client operation；start hook fail 就 fallback 去 built-in initial attributes。

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

Hook signatures：

- 三種 transports：`startSpanHook(request): Attributes`（同步，create span 之前）
- HTTP：`requestHook(span, request)` 同 `responseHook(span, response, request)`
- SSE：`requestHook(span, request)` 同 `responseHook(span, stream, request)`
- WebSocket：`requestHook(span, request)` 同 `responseHook(span, session, request)`

Empty transport object 會 enable 嗰個 transport。舊嘅 boolean transport switches 同舊 top-level hooks 會被 reject — 用 transport option objects 同 transport-scoped hooks。

## Operation identity 同 propagation

當 command 有穩定 identity 時，喺 `defineRequest`、`defineEventStream` 或者 `defineWebSocket` set static `operation`。Adapter 會用佢做 span names，同做 `defjs.operation`。佢永遠唔會由 resolved path、identifier、tenant 或者 query string derive identity：

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

Span names 會變成 `GET orders.read`、`SSE orders.watch`、`WebSocket orders.connect`。冇 `operation` 時，fallback 係 method / `SSE` / `WebSocket`，同埋省略 `defjs.operation`。

HTTP 同 SSE 會將 propagated fields inject 入 request headers。Existing `Headers` instances 會 reuse 同 mutate；否則 create 新 `Headers`。WebSocket query propagation 係 **opt-in**（browsers 唔可以加 arbitrary handshake headers）：

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

有 `queryPropagation` 時，propagator fields 會 append 去 connection query string。先 review URL logging、proxy visibility、access logs、baggage 同 retention。`requireParentSpan: true` 喺冇 active parent 時會 skip span creation、propagation、hooks 同 metrics，之後 unchanged call `next`。

## HTTP、SSE 同 WebSocket semantics

Adapter 量嘅係 transport lifetimes，唔係 command interpretation 嘅每一級。

- **HTTP** — span 喺 HTTP interceptor 裡面開始，拿到 Defjs `HttpResponse` 就結束。Media type 檢查、representation 讀取同 Struct 解碼全部喺之後，所以之後嘅 `RES_*` fault 改唔到已經結束嘅 transport span。又因為 span 活喺 chain 裡面，transport 層嘅 reject 會照 OTel 慣例記成 exception class，而唔係執行階段之後才判定嘅 fault code。
- **SSE** — span 開住直至 `stream.closed` settle。Record `sse.connected`，之後 `sse.closed` / `sse.aborted` / `sse.error`。一條 logical stream（包括 reconnects）→ 一個 span。冇 per-event spans。
- **WebSocket** — span 開住直至 `session.closed` settle。Events：`websocket.connected`、`websocket.closed`、`websocket.error`。Reconnecting physical sockets 仍然係 logical session 一部分。冇 per-message spans。

需要最終 command result，唔淨係 transport？將 `client.execute(...)` wrap 喺 application span：

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

Outer span 係你嘅。Plugin 仍然報告更低層嘅 transport span — 兩個唔同問題。

## Reference

有提供 `meter` 時：

| Metric                                       | Meaning                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `http.client.request.duration`               | HTTP request duration（seconds）                  |
| `defjs.client.sse.connect.duration`          | 直至 SSE handle return 嘅時間                     |
| `defjs.client.sse.connection.duration`       | Handle return → terminal close                    |
| `defjs.client.sse.active_streams`            | 有 pending `closed` 嘅 logical SSE handles        |
| `defjs.client.websocket.connect.duration`    | 直至 WebSocket session return 嘅時間              |
| `defjs.client.websocket.connection.duration` | Session return → terminal close                   |
| `defjs.client.websocket.active_connections`  | 有 pending `closed` 嘅 logical WebSocket sessions |

Active SSE/WebSocket instruments 數嘅係 logical resources（包括 reconnect gaps），唔係 physical sockets 或者個別 HTTP attempts。

HTTP spans record method、resolved `url.full`、有就有 server address/port，同收到時嘅 response status。Default `url.full` 會將 `request.endpoint` resolve against optional `request.baseEndpoint`，唔會 append 獨立嘅 `request.queryString`。呢個係 construction boundary，唔係 sanitization。要完整或 redact 過嘅 application-owned URL，就用 `startSpanHook` build。Status `400+` → span status `ERROR`，用 status string 做 `error.type`。Status `100..399` 留 span status unset。Status-zero transport outcome 冇 response status；cancel 留 status unset；timeout/其他 transport failures 用 `NET_TIMEOUT` 或者 `NET_UNREACHABLE`。Metrics 用 stable dimensions：method、static operation、server address/port、response status、low-cardinality error type。

SSE/WebSocket connection metrics record connect time、logical connection duration、active resource count、`defjs.result`、operation、server address/port，同 low-cardinality failure types。預設冇 request/response bodies、message payloads、queue lengths，或者 per-message spans。

將 `url.full` 同 `recordException(...)` 當可能敏感。Defjs 唔會代你 redact。Keep operation names 同 hook attributes allowlisted；喺 `startSpanHook` 或 SDK processors/exporters redact。Review privacy、cardinality、retention 同 redaction 之前，唔好將 raw URLs、query strings、headers、baggage 或者 payloads copy 入 custom telemetry。

WebSocket query propagation 可以將 trace context 同 baggage 暴露畀 browsers、proxies、access logs 同 telemetry。佢唔係 credential channel。`withCredentials(true)` 係 HTTP/SSE 嘅 Fetch credentials — 唔係 WebSocket auth。

Adapter 唔會 init/shut down SDK，亦唔會 dispose core client 或者 transport handles。你 flush telemetry，同 close HTTP/SSE/WebSocket work。睇 [Interceptors](../core/interceptors.md)、[SSE](../core/sse.md) 同 [WebSocket](../core/web-socket.md)。

## Related recipes

- [Test with a local Fetch handle](../recipes/test-with-handle.md)
- [Consume an SSE stream](../recipes/consume-sse.md)
- [Open a WebSocket session](../recipes/websocket-session.md)
