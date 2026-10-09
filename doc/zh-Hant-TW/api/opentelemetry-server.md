---
title: '@defjs/opentelemetry-server'
description: withOpenTelemetryServer，以及各傳輸的 options。
---

# OpenTelemetry server {#page}

以 core interceptors 做 HTTP／SSE／WebSocket 出站 instrumentation。這個套件不會初始化 OpenTelemetry SDK，也不是入站伺服器 instrumentation。

見 [OpenTelemetry server 指南](/plugins/opentelemetry-server)。

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

每個啟用的傳輸追加一條 interceptor。在 `createClient` 時套用。

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer` 必填。`meter` 可選——不傳就不記這個套件的 metrics。不傳 `propagator` → W3C Trace Context + Baggage。

HTTP、SSE、WebSocket 預設開。某個傳輸傳 `{ enabled: false }` 就跳過。

## OpenTelemetryServerOptions {#OpenTelemetryServerOptions}

```ts
interface OpenTelemetryServerOptions {
  tracer: Tracer
  meter?: Meter
  propagator?: TextMapPropagator
  requireParentSpan?: boolean
  http?: OpenTelemetryServerHttpOptions
  sse?: OpenTelemetryServerSSEOptions
  webSocket?: OpenTelemetryServerWebSocketOptions
}
```

## OpenTelemetryServerTransportOptions {#OpenTelemetryServerTransportOptions}

### OpenTelemetryServerHttpOptions {#OpenTelemetryServerHttpOptions}

### OpenTelemetryServerSSEOptions {#OpenTelemetryServerSSEOptions}

### OpenTelemetryServerWebSocketOptions {#OpenTelemetryServerWebSocketOptions}

```ts
interface OpenTelemetryServerTransportOptions<TResponse> {
  enabled?: boolean
  startSpanHook?: (request: HttpRequest) => Attributes
  requestHook?: (span: Span, req: HttpRequest) => Promise<void> | void
  responseHook?: (span: Span, res: TResponse, req: HttpRequest) => Promise<void> | void
}

type OpenTelemetryServerHttpOptions = OpenTelemetryServerTransportOptions<HttpResponse<unknown>>
type OpenTelemetryServerSSEOptions = OpenTelemetryServerTransportOptions<EventStreamHandle<unknown>>
interface OpenTelemetryServerWebSocketOptions extends OpenTelemetryServerTransportOptions<WebSocketSessionLike> {
  queryPropagation?: boolean
}
```

`startSpanHook` 會在對應 HTTP、SSE 或 WebSocket transport 建立 span 前同步執行。回傳的 attributes 會在內建 attributes 之後套用，因此應用程式可以覆寫 `url.full` 或其他初始值。Hook 丟錯時，Defjs 會用內建 attributes 建立 span、記錄 `defjs.otel.hook.error`，並繼續請求；`requestHook` 與 `responseHook` 保持建立 span 後執行的語意。

預設 `url.full` 只會把 `request.endpoint` 相對於選填的 `request.baseEndpoint` 解析，不會附加獨立的 `request.queryString`。這條邊界不是脫敏；套件沒有內建 redactor 或敏感 key 政策。請明確建構應用程式自有 URL，並視需要刪除敏感參數：

```ts
import { createResolvedRequestUrl, type HttpRequest } from '@defjs/core'
import type { Attributes } from '@opentelemetry/api'

const http = {
  startSpanHook(request: HttpRequest): Attributes {
    if (!request.baseEndpoint) return {}
    const url = createResolvedRequestUrl(request.baseEndpoint, request.endpoint)
    if (request.queryString) url.search = request.queryString
    url.searchParams.delete('access_token')
    return { 'url.full': url.href }
  },
}
```

`queryPropagation` 預設 `false`。只有你接受把 trace context 放進 WebSocket URL 時才打開。
