---
title: OpenTelemetry server
description: Activa la instrumentación saliente de transporte Defjs con tu propio Tracer y un Meter opcional.
---

# OpenTelemetry server

Activa la instrumentación saliente cuando creas el cliente. `@defjs/opentelemetry-server` añade interceptores HTTP, SSE y WebSocket. **No** es instrumentación de servidor entrante y **no** inicializa un SDK de OpenTelemetry.

## Basic Setup

Inicializa el SDK en otro sitio. Pasa sus objetos de API:

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

`tracer` es obligatorio. `meter` es opcional — omítelo para desactivar las métricas del paquete. Sin `propagator` → el adapter construye un propagador compuesto W3C Trace Context + W3C Baggage. No lee ni inicializa la config global del SDK por ti.

`withOpenTelemetryServer(options)` devuelve un `ClientOption` de core. Aplícalo en el momento de `createClient` para que se añada un interceptor por transporte habilitado. HTTP, SSE y WebSocket están habilitados por defecto; `{ enabled: false }` desactiva un transporte.

El adapter puede crear telemetría de transporte incluso cuando la solicitud falla en la capa de transporte. Que se exporte algo depende de tu SDK y exporters.

## Ámbito

Tú eres dueño de la init del SDK, providers, exporters, processors, context, sampling, redacción, flush y shutdown. Este paquete consume el `Tracer`, el `Meter` opcional y el `TextMapPropagator` opcional que le pasas. No incluye redactor ni política de claves sensibles.

Sin caché, reintentos, spans a nivel de mensaje ni política de outcome de comandos de aplicación. Pensado para Node.js del lado servidor. El paquete publicado necesita Node.js 22+, peers `@defjs/core`, `@opentelemetry/api` 1.x, `@opentelemetry/core` 2.x.

API pública: `withOpenTelemetryServer` más `OpenTelemetryServerOptions`, `OpenTelemetryServerHttpOptions`, `OpenTelemetryServerSSEOptions`, `OpenTelemetryServerWebSocketOptions`.

## Opciones y hooks

Los hooks se sitúan junto al transporte que cambian. El `startSpanHook(request)` síncrono se ejecuta antes de crear el span y devuelve `Attributes` iniciales; los atributos de la aplicación se aplican al final y pueden sobrescribir los incorporados. `requestHook` y `responseHook` reciben el span ya creado y pueden devolver `void` o una Promise. Todo fallo registra `defjs.otel.hook.error` sin detener la operación; si falla el start hook se usan los atributos incorporados.

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

Firmas de hook:

- Los tres transportes: `startSpanHook(request): Attributes` (síncrono, antes de crear el span)
- HTTP: `requestHook(span, request)` y `responseHook(span, response, request)`
- SSE: `requestHook(span, request)` y `responseHook(span, stream, request)`
- WebSocket: `requestHook(span, request)` y `responseHook(span, session, request)`

Un objeto de transporte vacío habilita ese transporte. Los switches booleanos antiguos de transporte y los hooks top-level antiguos se rechazan — usa objetos de opción de transporte y hooks acotados al transporte.

## Identidad de operación y propagación

Pon un `operation` estático en `defineRequest`, `defineEventStream` o `defineWebSocket` cuando el comando tenga una identidad estable. El adapter lo usa en nombres de span y como `defjs.operation`. Nunca deriva identidad de un path resuelto, identificador, tenant o query string:

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

Los nombres de span pasan a ser `GET orders.read`, `SSE orders.watch`, `WebSocket orders.connect`. Sin `operation`, el fallback es method / `SSE` / `WebSocket`, y se omite `defjs.operation`.

HTTP y SSE inyectan campos propagados en las cabeceras de la solicitud. Las instancias `Headers` existentes se reutilizan y mutan; si no, se crea un `Headers` nuevo. La propagación por query de WebSocket es **opt-in** (los navegadores no pueden añadir cabeceras arbitrarias de handshake):

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

Con `queryPropagation`, los campos del propagador se añaden al query string de la conexión. Revisa antes el logging de URL, la visibilidad del proxy, los access logs, el baggage y la retención. `requireParentSpan: true` salta la creación de span, la propagación, los hooks y las métricas cuando no hay padre activo, y luego llama a `next` sin cambios.

## Semántica HTTP, SSE y WebSocket

El adapter mide lifetimes de transporte, no cada etapa de la interpretación del comando.

- **HTTP** — el span empieza en el interceptor HTTP y termina cuando recibe el `HttpResponse` de Defjs. La comprobación del media type, la lectura de la representación y la decodificación del Struct pasan todas después, así que un fault `RES_*` posterior no puede actualizar el span de transporte ya terminado. Y como el span vive dentro de la cadena, un rechazo de transporte se registra con la clase de excepción según la convención de OTel, no con el código de fault que la ejecución asigna más tarde.
- **SSE** — el span se queda abierto hasta que se asienta `stream.closed`. Registra `sse.connected`, luego `sse.closed` / `sse.aborted` / `sse.error`. Un stream lógico (incluyendo reconnects) → un span. Sin spans por evento.
- **WebSocket** — el span se queda abierto hasta que se asienta `session.closed`. Eventos: `websocket.connected`, `websocket.closed`, `websocket.error`. Los sockets físicos que reconectan siguen formando parte de la sesión lógica. Sin spans por mensaje.

¿Necesitas el resultado final del comando, no solo el transporte? Envuelve `client.execute(...)` en un span de aplicación:

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

El span exterior es tuyo. El plugin sigue reportando el span de transporte de nivel inferior — dos preguntas distintas.

## Reference

Cuando se suministra `meter`:

| Métrica                                      | Significado                                       |
| -------------------------------------------- | ------------------------------------------------- |
| `http.client.request.duration`               | Duración de la solicitud HTTP (segundos)          |
| `defjs.client.sse.connect.duration`          | Tiempo hasta devolver el handle SSE               |
| `defjs.client.sse.connection.duration`       | Devolución del handle → cierre terminal           |
| `defjs.client.sse.active_streams`            | Handles SSE lógicos con `closed` pendiente        |
| `defjs.client.websocket.connect.duration`    | Tiempo hasta devolver la sesión WebSocket         |
| `defjs.client.websocket.connection.duration` | Devolución de la sesión → cierre terminal         |
| `defjs.client.websocket.active_connections`  | Sesiones WebSocket lógicas con `closed` pendiente |

Los instrumentos activos SSE/WebSocket cuentan recursos lógicos (incluyendo huecos de reconnect), no sockets físicos ni intentos HTTP individuales.

Los spans HTTP registran método, `url.full` resuelto, dirección/puerto del servidor cuando están disponibles, y el estado de respuesta cuando se recibe. Por defecto, `url.full` solo resuelve `request.endpoint` contra el `request.baseEndpoint` opcional y no añade un `request.queryString` independiente. Es un límite de construcción, no redaction; crea una URL completa o redactada de la aplicación en `startSpanHook`. Estado `400+` → estado del span `ERROR` con la cadena de estado como `error.type`. Estado `100..399` deja el estado del span sin fijar. Un outcome de transporte con estado cero no tiene estado de respuesta; cancel deja el estado sin fijar; timeout/otros fallos de transporte usan `NET_TIMEOUT` o `NET_UNREACHABLE`. Las métricas usan dimensiones estables: método, operación estática, dirección/puerto del servidor, estado de respuesta, tipo de error de baja cardinalidad.

Las métricas de conexión SSE/WebSocket registran tiempo de connect, duración lógica de la conexión, conteo de recursos activos, `defjs.result`, operación, dirección/puerto del servidor y tipos de fallo de baja cardinalidad. Sin cuerpos de solicitud/respuesta, payloads de mensaje, longitudes de cola ni spans por mensaje por defecto.

Trata `url.full` y `recordException(...)` como potencialmente sensibles. Defjs no los redacta por ti. Mantén nombres de operación y atributos de hook en allowlist; redacta en `startSpanHook` o processors/exporters del SDK. No copies URL en bruto, query strings, cabeceras, baggage o payloads a telemetría personalizada sin revisar privacidad, cardinalidad, retención y redacción.

La propagación por query de WebSocket puede exponer contexto de trace y baggage a navegadores, proxies, access logs y telemetría. No es un canal de credenciales. `withCredentials(true)` son credenciales Fetch para HTTP/SSE — no auth de WebSocket.

El adapter no inicia/apaga el SDK, y no dispone el cliente core ni los handles de transporte. Tú flusheas la telemetría y cierras el trabajo HTTP/SSE/WebSocket. Ver [Interceptores](../core/interceptors.md), [SSE](../core/sse.md) y [WebSocket](../core/web-socket.md).

## Recetas relacionadas

- [Probar con un handle Fetch local](../recipes/test-with-handle.md)
- [Consumir un stream SSE](../recipes/consume-sse.md)
- [Abrir una sesión WebSocket](../recipes/websocket-session.md)
