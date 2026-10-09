---
title: '@defjs/opentelemetry-server'
description: withOpenTelemetryServer und Optionen pro Transport.
---

# OpenTelemetry server {#page}

Outbound-HTTP- / SSE- / WebSocket-Instrumentierung als Core-Interceptors. Dieses Paket initialisiert kein OpenTelemetry-SDK und ist keine eingehende Server-Instrumentierung.

Siehe den [OpenTelemetry-Server-Guide](/plugins/opentelemetry-server).

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

Hängt pro aktivem Transport einen Interceptor an. Beim `createClient` drauflegen.

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer` ist Pflicht. `meter` ist optional — weglassen, dann keine Paket-Metriken. Kein `propagator` → W3C Trace Context + Baggage.

HTTP, SSE und WebSocket sind standardmäßig an. `{ enabled: false }` auf einem Transport überspringt ihn.

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

`startSpanHook` läuft für den jeweiligen HTTP-, SSE- oder WebSocket-Transport synchron vor der Span-Erzeugung. Seine Attribute werden nach den Built-in-Attributen angewandt, die Application darf also `url.full` oder einen anderen Initialwert überschreiben. Throwt er, erzeugt Defjs den Span mit Built-in-Attributen, zeichnet `defjs.otel.hook.error` auf und setzt den Request fort; `requestHook` und `responseHook` behalten ihre bisherige Semantik nach der Erzeugung.

Standardmäßig löst `url.full` nur `request.endpoint` gegen das optionale `request.baseEndpoint` auf; ein unabhängiges `request.queryString` wird nicht angehängt. Diese Grenze ist keine Redaction, und das Paket hat keinen eingebauten Redactor oder eine Sensitive-Key-Policy. Baue eine Application-eigene URL explizit und redact sie bei Bedarf:

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

`queryPropagation` ist standardmäßig `false`. Nur einschalten, wenn du Trace-Context in der WebSocket-URL akzeptierst.
