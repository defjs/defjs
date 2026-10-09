---
title: OpenTelemetry server
description: 用你自己的 Tracer 與選填 Meter，開啟出站 Defjs 傳輸 instrumentation。
---

# OpenTelemetry server

在建立 client 時開啟出站 instrumentation。`@defjs/opentelemetry-server` 會追加 HTTP、SSE、WebSocket interceptors。它**不是** inbound 伺服器 instrumentation，也**不會**初始化 OpenTelemetry SDK。

## Basic Setup

在別處初始化 SDK。把 API 物件傳進來：

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

`tracer` 必填。`meter` 選填 — 省略就關掉套件 metrics。沒有 `propagator` → adapter 會建 composite W3C Trace Context + W3C Baggage propagator。它不會替你讀或初始化全域 SDK 設定。

`withOpenTelemetryServer(options)` 回傳 core `ClientOption`。在 `createClient` 時套用，讓每個啟用的傳輸追加一個 interceptor。HTTP、SSE、WebSocket 預設啟用；`{ enabled: false }` 關掉單一傳輸。

即使請求在傳輸層失敗，adapter 仍可建立傳輸遙測。有沒有東西被匯出，取決於你的 SDK 與 exporters。

## 範圍

SDK init、providers、exporters、processors、context、sampling、redaction、flush、shutdown 由你負責。這個套件消費你傳入的 `Tracer`、選填 `Meter`、選填 `TextMapPropagator`。它不提供內建 redactor 或敏感 key 政策。

沒有快取、重試、訊息層級 spans，或應用 command-outcome 政策。目標是伺服器端 Node.js。已發布套件需要 Node.js 22+，peers 是 `@defjs/core`、`@opentelemetry/api` 1.x、`@opentelemetry/core` 2.x。

公開 API：`withOpenTelemetryServer`，以及 `OpenTelemetryServerOptions`、`OpenTelemetryServerHttpOptions`、`OpenTelemetryServerSSEOptions`、`OpenTelemetryServerWebSocketOptions`。

## Options 與 hooks

Hooks 放在它們會改動的傳輸旁邊。同步 `startSpanHook(request)` 會在建立 span 前執行並回傳初始 `Attributes`；應用程式 attributes 最後套用，因此可以覆寫內建值。`requestHook` 與 `responseHook` 收到已建立的 span，可以回傳 `void` 或 promise。Hook 失敗會記錄 `defjs.otel.hook.error`，且**不會**停掉 client 操作；start hook 失敗時會退回內建初始 attributes。

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

Hook 簽名：

- 三種傳輸：`startSpanHook(request): Attributes`（同步，在建立 span 前）
- HTTP：`requestHook(span, request)` 與 `responseHook(span, response, request)`
- SSE：`requestHook(span, request)` 與 `responseHook(span, stream, request)`
- WebSocket：`requestHook(span, request)` 與 `responseHook(span, session, request)`

空的傳輸物件會啟用該傳輸。舊的 boolean 傳輸開關與舊的頂層 hooks 會被拒絕 — 改用傳輸 option 物件與傳輸範圍的 hooks。

## 操作身分與 propagation

當 command 有穩定身分時，在 `defineRequest`、`defineEventStream` 或 `defineWebSocket` 設 static `operation`。Adapter 用它做 span names，並當成 `defjs.operation`。它絕不會從解析後的 path、identifier、tenant 或 query string 推身分：

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

Span names 會變成 `GET orders.read`、`SSE orders.watch`、`WebSocket orders.connect`。沒有 `operation` 時，fallback 是 method／`SSE`／`WebSocket`，並省略 `defjs.operation`。

HTTP 與 SSE 把 propagated fields 注入 request headers。既有的 `Headers` 實例會被重用並 mutate；否則建立新的 `Headers`。WebSocket query propagation 是**選擇性開啟**（瀏覽器不能加任意 handshake headers）：

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

有 `queryPropagation` 時，propagator fields 會附加到連線 query string。先審 URL logging、proxy 可見性、access logs、baggage、retention。`requireParentSpan: true` 在沒有 active parent 時跳過 span 建立、propagation、hooks、metrics，然後原樣呼叫 `next`。

## HTTP、SSE、WebSocket 語意

Adapter 量的是傳輸生命週期，不是 command 解讀的每一階段。

- **HTTP** — span 在 HTTP interceptor 裡開始，拿到 Defjs `HttpResponse` 就結束。媒體類型檢查、表示讀取與 Struct 解碼都在之後，所以後續的 `RES_*` fault 改不了已結束的傳輸 span。又因為 span 活在鏈內，傳輸層的 reject 會按 OTel 慣例記成例外類別，而不是執行階段之後才判定的 fault code。
- **SSE** — span 維持開啟直到 `stream.closed` settle。記錄 `sse.connected`，然後 `sse.closed`／`sse.aborted`／`sse.error`。一個邏輯串流（含重連）→ 一個 span。沒有 per-event spans。
- **WebSocket** — span 維持開啟直到 `session.closed` settle。事件：`websocket.connected`、`websocket.closed`、`websocket.error`。重連中的實體 sockets 仍屬邏輯 session。沒有 per-message spans。

需要最終 command 結果，而不只是傳輸？把 `client.execute(...)` 包進應用 span：

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

外層 span 是你的。Plugin 仍會回報較低階的傳輸 span — 兩個不同問題。

## Reference

有提供 `meter` 時：

| Metric                                       | 意義                                            |
| -------------------------------------------- | ----------------------------------------------- |
| `http.client.request.duration`               | HTTP 請求持續時間（秒）                         |
| `defjs.client.sse.connect.duration`          | 到 SSE handle 回傳為止的時間                    |
| `defjs.client.sse.connection.duration`       | Handle 回傳 → 終端 close                        |
| `defjs.client.sse.active_streams`            | 仍有 pending `closed` 的邏輯 SSE handles        |
| `defjs.client.websocket.connect.duration`    | 到 WebSocket session 回傳為止的時間             |
| `defjs.client.websocket.connection.duration` | Session 回傳 → 終端 close                       |
| `defjs.client.websocket.active_connections`  | 仍有 pending `closed` 的邏輯 WebSocket sessions |

Active SSE／WebSocket instruments 計的是邏輯資源（含重連空檔），不是實體 sockets 或個別 HTTP attempts。

HTTP spans 記錄 method、解析後的 `url.full`、可用時的 server address／port，以及收到時的回應 status。預設 `url.full` 會把 `request.endpoint` 相對於選填的 `request.baseEndpoint` 解析，不會附加獨立的 `request.queryString`。這是建構邊界，不是脫敏。需要完整或脫敏後的應用程式自有 URL 時，請用 `startSpanHook` 建構。Status `400+` → span status `ERROR`，並以 status string 當 `error.type`。Status `100..399` 不設 span status。Status-zero 傳輸結果沒有回應 status；取消不設 status；逾時／其他傳輸失敗用 `NET_TIMEOUT` 或 `NET_UNREACHABLE`。Metrics 用穩定維度：method、static operation、server address／port、回應 status、低基數錯誤型別。

SSE／WebSocket connection metrics 記錄 connect 時間、邏輯連線持續時間、active 資源數、`defjs.result`、operation、server address／port、低基數失敗型別。預設沒有 request／response bodies、訊息 payloads、queue 長度，或 per-message spans。

把 `url.full` 與 `recordException(...)` 當可能敏感。Defjs 不會替你遮罩。操作名稱與 hook attributes 維持 allowlist；在 `startSpanHook` 或 SDK processors／exporters 做遮罩。未經隱私、基數、retention、redaction 審查，別把原始 URLs、query strings、headers、baggage 或 payloads 複製進自訂遙測。

WebSocket query propagation 可能把 trace context 與 baggage 暴露給瀏覽器、proxies、access logs、遙測。它不是憑證通道。`withCredentials(true)` 是 HTTP／SSE 的 Fetch credentials — 不是 WebSocket auth。

Adapter 不會 init／shut down SDK，也不會 dispose core client 或傳輸 handles。你負責 flush 遙測並關閉 HTTP／SSE／WebSocket 工作。見 [Interceptors](../core/interceptors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md)。

## 相關 recipes

- [用本機 Fetch handle 測試](../recipes/test-with-handle.md)
- [消費 SSE 串流](../recipes/consume-sse.md)
- [開啟 WebSocket session](../recipes/websocket-session.md)
