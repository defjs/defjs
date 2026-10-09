---
title: '@defjs/opentelemetry-server'
description: 出站埋点 option：`withOpenTelemetryServer`。
---

# OpenTelemetry server {#page}

创建 Client 时打开出站埋点。追加 HTTP、SSE、WebSocket interceptor。它**不是**入站服务端埋点，也**不会**初始化 OpenTelemetry SDK。

见 [OpenTelemetry server 指南](/plugins/opentelemetry-server)。

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

每个启用的传输追加一条 interceptor。叠在 `createClient` 上。

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer` 必填。`meter` 可选——不传就不记这个包的 metrics。不传 `propagator` → W3C Trace Context + Baggage。

HTTP、SSE、WebSocket 默认开。某个传输传 `{ enabled: false }` 就跳过。

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

`startSpanHook` 在对应 HTTP、SSE 或 WebSocket transport 创建 span 前同步运行。返回属性在内建属性之后应用，因此应用可以覆盖 `url.full` 或其他初始值。Hook 抛错时，Defjs 会用内建属性创建 span、记录 `defjs.otel.hook.error`，并继续请求；`requestHook` 与 `responseHook` 保持创建 span 后执行的语义。

默认 `url.full` 只把 `request.endpoint` 相对可选 `request.baseEndpoint` 解析，不会追加独立的 `request.queryString`。这条边界不是脱敏；包内没有内建 redactor 或敏感 key 政策。请显式构造应用自有 URL，并按需删除敏感参数：

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

`queryPropagation` 默认 `false`。只有你接受把 trace context 放进 WebSocket URL 时才打开。
