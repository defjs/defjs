---
title: '@defjs/opentelemetry-server'
description: withOpenTelemetryServer 同 per-transport options。
---

# OpenTelemetry server {#page}

Outbound HTTP / SSE / WebSocket instrumentation，以 core interceptors 形式提供。呢個 package 唔會 initialize OpenTelemetry SDK，亦唔係 inbound server instrumentation。

見 [OpenTelemetry server guide](/plugins/opentelemetry-server)。

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

每個 enabled transport append 一條 interceptor。喺 `createClient` 時 apply。

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer` 必填。`meter` 可選——唔傳就唔記呢個 package 嘅 metrics。唔傳 `propagator` → W3C Trace Context + Baggage。

HTTP、SSE、WebSocket 預設開。某個 transport 傳 `{ enabled: false }` 就 skip。

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

`startSpanHook` 會喺相應 HTTP、SSE 或 WebSocket transport create span 之前同步 run。Return 嘅 attributes 會喺 built-in attributes 之後 apply，所以 application 可以 override `url.full` 或其他 initial value。Hook throw 時，Defjs 會用 built-in attributes create span、record `defjs.otel.hook.error`，再繼續個 request；`requestHook` 同 `responseHook` 保持 create span 之後先 run 嘅 semantics。

預設 `url.full` 淨係會將 `request.endpoint` resolve against optional `request.baseEndpoint`；獨立嘅 `request.queryString` 唔會 append。呢條 boundary 唔係 redaction，package 亦冇 built-in redactor 或 sensitive-key policy。要明確砌一條 application-owned URL，需要嘅話再 redact：

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

`queryPropagation` 預設 `false`。只有你接受 trace context 出現喺 WebSocket URL 先至開。
