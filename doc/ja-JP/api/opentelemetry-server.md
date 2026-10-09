---
title: '@defjs/opentelemetry-server'
description: withOpenTelemetryServer と、トランスポートごとの options です。
---

# OpenTelemetry server {#page}

アウトバウンドの HTTP / SSE / WebSocket 計装を、コアのインターセプターとして足します。このパッケージは OpenTelemetry SDK を初期化せず、インバウンドのサーバー計装でもありません。

[OpenTelemetry server ガイド](/plugins/opentelemetry-server) を見てください。

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

有効なトランスポートごとにインターセプターを 1 本足します。`createClient` のときに当ててください。

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer` は必須です。`meter` は任意 — 省略するとこのパッケージのメトリクスは出しません。`propagator` が無い → W3C Trace Context + Baggage です。

HTTP、SSE、WebSocket は既定でオンです。トランスポートに `{ enabled: false }` を渡すとスキップします。

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

`startSpanHook` は、自分の HTTP、SSE、または WebSocket トランスポートについて、span 作成前に同期実行されます。その属性は組み込み属性のあとに適用されるので、アプリケーションは `url.full` や別の初期値を上書きできます。throw すると Defjs は組み込み属性で span を作り、`defjs.otel.hook.error` を記録し、リクエストを続けます。`requestHook` と `responseHook` は、作成後の既存の意味論のままです。

デフォルトでは、`url.full` は任意の `request.baseEndpoint` に対して `request.endpoint` を解決するだけで、独立した `request.queryString` は付けません。その境界は redaction ではなく、このパッケージに組み込みの redactor や機微キーの方針もありません。必要なら、アプリケーションが所有する URL を明示的に組み立て、必要に応じて redact してください。

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

`queryPropagation` の既定は `false` です。WebSocket URL に trace context を載せてよいと受け入れたあとでのみ、オンにしてください。
