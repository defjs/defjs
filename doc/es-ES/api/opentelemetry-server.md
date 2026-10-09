---
title: '@defjs/opentelemetry-server'
description: withOpenTelemetryServer y opciones por transporte.
---

# OpenTelemetry server {#page}

Instrumentación de salida HTTP / SSE / WebSocket como interceptores del core. Este paquete no inicializa un SDK de OpenTelemetry, y no es instrumentación de servidor de entrada.

Mira la [guía de OpenTelemetry server](/plugins/opentelemetry-server).

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

Añade un interceptor por transporte activo. Aplícalo en `createClient`.

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer` es obligatorio. `meter` es opcional — si lo omites, no hay metrics del paquete. Sin `propagator` → W3C Trace Context + Baggage.

HTTP, SSE y WebSocket van on por defecto. `{ enabled: false }` salta un transporte.

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

`startSpanHook` se ejecuta de forma síncrona antes de crear el span de su propio transporte HTTP, SSE o WebSocket. Sus atributos se aplican después de los atributos incorporados, así que la aplicación puede sobrescribir `url.full` u otro valor inicial. Si lanza, Defjs crea el span con los atributos incorporados, registra `defjs.otel.hook.error` y continúa la solicitud; `requestHook` y `responseHook` conservan su semántica existente posterior a la creación.

Por defecto, `url.full` solo resuelve `request.endpoint` contra el `request.baseEndpoint` opcional; un `request.queryString` independiente no se añade. Ese límite no es redaction, y el paquete no tiene un redactor incorporado ni una política de claves sensibles. Construye y, si hace falta, redacta de forma explícita una URL que posea la aplicación:

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

`queryPropagation` vale `false` por defecto. Actívalo solo después de aceptar el trace context en la URL de WebSocket.
