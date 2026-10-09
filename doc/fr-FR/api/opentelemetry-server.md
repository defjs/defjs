---
title: '@defjs/opentelemetry-server'
description: withOpenTelemetryServer et options par transport.
---

# OpenTelemetry server {#page}

Instrumentation sortante HTTP / SSE / WebSocket, sous forme d’intercepteurs core. Ce paquet n’initialise pas un SDK OpenTelemetry, et ce n’est pas de l’instrumentation serveur entrante.

Voir le [guide OpenTelemetry server](/plugins/opentelemetry-server).

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

Ajoute un intercepteur par transport activé. Applique-le au moment de `createClient`.

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer` est obligatoire. `meter` est optionnel — omets-le pour sauter les métriques du paquet. Pas de `propagator` → W3C Trace Context + Baggage.

HTTP, SSE et WebSocket sont on par défaut. Passe `{ enabled: false }` sur un transport pour le sauter.

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

`startSpanHook` s’exécute synchroniquement avant la création du span, pour son propre transport HTTP, SSE ou WebSocket. Ses attributs sont appliqués après les attributs intégrés, donc l’application peut overrider `url.full` ou une autre valeur initiale. S’il throw, Defjs crée le span avec les attributs intégrés, enregistre `defjs.otel.hook.error` et continue la requête ; `requestHook` et `responseHook` gardent leur sémantique existante, postérieure à la création.

Par défaut, `url.full` ne résout que `request.endpoint` contre l’éventuel `request.baseEndpoint` ; un `request.queryString` indépendant n’est pas ajouté. Cette frontière n’est pas une redaction, et le paquet n’a ni redactor intégré ni politique de clés sensibles. Construis, et masque si besoin, une URL possédée par l’application, explicitement :

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

`queryPropagation` vaut `false` par défaut. Ne l’active qu’après avoir accepté le trace context dans l’URL WebSocket.
