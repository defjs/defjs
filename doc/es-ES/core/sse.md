---
title: Server-Sent Events
description: Consume un stream SSE tipado, ciérralo y espera la promesa terminal closed.
---

# Server-Sent Events

Abre un stream, itéralo y luego suelta el handle que posees con `await using`. `close()` y `closed` manuales siguen disponibles; clientes y plugins no disponen por ti un stream devuelto.

## Basic Setup

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: {
    message: struct.object({ text: struct.string() }),
  },
})

const [error, stream] = await client.execute(notifications())
if (error) {
  console.error(error.code)
} else {
  await using ownedStream = stream
  for await (const event of ownedStream) {
    if (event.event === 'message') console.log(event.data.text)
  }
}
```

## Definir el stream

`defineEventStream(...)` necesita `events`, `maxBufferSize` entero seguro positivo, `maxQueueSize` entero seguro positivo y un `path` relativo. El método por defecto es `GET`.

La forma de la solicitud coincide con HTTP: `builder` opcional que devuelve `path`, `query`, `headers` y `body`. `GET` / `HEAD` no pueden devolver un body. Un struct `error` declarado tipa el fault de arranque y decodifica un cuerpo de handshake no-2xx según el kind del struct (`string` texto, `blob` / `file` blob, `arrayBuffer` bytes, si no JSON). Defjs envía `Accept: text/event-stream` cuando no pusiste ya `Accept`.

Un stream lógico puede abarcar varios intentos Fetch físicos **cuando** optas por reconnect. Sin `withSSEReconnect`, los fallos transitorios de red y de lectura del stream terminan el stream lógico. Sigues teniendo un handle y un iterador async cuando el open tiene éxito.

## Abrir e inspeccionar

`client.execute(...)` se resuelve solo después de que pasen las comprobaciones de estado, content-type y cuerpo:

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: { message: struct.string() },
})

const [error, stream, startupOpen] = await client.execute(notifications())
if (error) {
  console.error(error.code, startupOpen?.response.status)
} else {
  console.log(stream.open.response.status, startupOpen.response.status, stream.open.url)
  stream.close('example-finished')
  await stream.closed
}
```

La respuesta debe ser exitosa, con esencia de media type `text/event-stream`, y tener cuerpo. Arranque no-2xx → `HTTP_STATUS`. Cuando se declara `error`, ese fault lleva el cuerpo de handshake decodificado; un media type malo es `RES_MEDIA_TYPE_INVALID` y un cuerpo que no se puede leer como el kind declarado es `RES_DECODE_FAILED`. Un snapshot de respuesta aún puede quedar en el tercer hueco de la tupla cuando la validación falla después de que llega la respuesta.

`startupOpen` es el snapshot inicial. `stream.open` está en vivo y cambia en opens físicos posteriores. Conserva el valor de la tupla cuando importa la primera respuesta.

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## Decodificar eventos

Nombre de evento en el cable → `events[eventName]`; si no, `events.default`. Sin Struct coincidente → el evento no se entrega. Campo SSE `event` ausente → nombre lógico `message`.

Los `data` SSE empiezan como texto. Un struct `string` conserva ese texto. Cualquier otro kind es JSON: parsea el texto y luego decodifica con el struct. `struct.object`, `struct.number`, `struct.boolean`, `struct.any` y `struct.unknown` son JSON, no texto recortado. Un token suelto como `ping` no satisface `struct.literal('ping')`; los datos tienen que ser JSON. Un servidor que envía el string JSON `"abc"` sí satisface `struct.string()`: el valor entregado es ese texto crudo, comillas incluidas, y no se decodifica como JSON a `abc`.

Valor emitido: `event`, `data` decodificado, `id` opcional no vacío. Con `default`, los nombres de evento desconocidos son `string` en la unión inferida.

## Observar eventos inválidos

Los eventos inválidos/no declarados se descartan, no se encolan. `withSSEOnInvalidEvent(...)` puede observar ID en bruto, nombre, datos de texto, más `missing-struct` o `validation-failed` y un cause opcional.

```ts
import { createClient, withEndpoint, withSSEOnInvalidEvent } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEOnInvalidEvent(({ reason, message, cause, signal }) => {
    if (signal.aborted) return
    console.info('Dropped SSE event', {
      reason,
      event: message.event,
      hasCause: cause !== undefined,
    })
  }),
)
```

El observador corre en el límite de transformación. Su fallo queda aislado salvo que el signal del intento activo esté abortado. Manténlo corto; no trates los datos de evento en bruto como de confianza.

## Reconnect

**Cambio de comportamiento:** el reconnect SSE es opt-in. Sin `withSSEReconnect(...)`, los fallos de red y de lectura del stream **no** se reintentan (igual que `attempts: 0`). Pasa `withSSEReconnect({ attempts: 3 })` (u otro presupuesto revisado) para reintentar esos fallos. El EOF normal no se reintenta. La validación de estado/content-type, los límites del parser, los fallos de transformación de mensaje, el overflow de cola y el EOF normal siguen siendo terminales para el stream lógico.

```ts
import { createClient, withEndpoint, withSSEReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEReconnect({
    attempts: 3,
    delayMs: 1_000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.5,
    shouldReconnect({ attempt, open }) {
      return attempt <= 3 && (open?.response.status ?? 0) !== 401
    },
  }),
)
```

`attempts` cuenta reintentos después del intento inicial; vale `3` por defecto cuando hay un objeto reconnect. `attempts: 0` desactiva el reintento. Omitir `withSSEReconnect` también lo desactiva. `delayMs` es el intervalo inicial; `factor` lo crece; `maxDelayMs` tapa la base. El `jitter` de SSE es un **factor multiplicativo 0–1**, igual que WebSocket. Un campo `retry:` del stream actualiza el intervalo actual. Un callback de política que devuelve false / lanza / rechaza termina el stream lógico.

El último ID de evento parseado se convierte en `Last-Event-ID` en un intento posterior. Un intento posterior reenvía la misma solicitud Fetch, incluido method y body. Conoce la semántica de replay del servidor antes de reconectar.

## Límites de buffer y cola

Ambos deben ser enteros seguros positivos. El overflow es fatal — no hay descarte silencioso de eventos antiguos.

| Límite          | Protege                                                         | Código terminal       |
| --------------- | --------------------------------------------------------------- | --------------------- |
| `maxBufferSize` | Línea/evento SSE incompleto/sobredimensionado al parsear        | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | Eventos producidos más rápido de lo que lee el único consumidor | `CAP_QUEUE_OVERFLOW`  |

Un stream fatal también limpia eventos en buffer, cancela el cuerpo activo, rechaza el iterador y resuelve `stream.closed` con `kind: 'error'`.

## Cerrar y disponer

`EventStreamHandle`: un snapshot de apertura en vivo, una promesa terminal, un `close`, un iterador async y un disposer async estándar.

```typescript twoslash
import type { EventStreamCloseInfo, EventStreamHandle, EventStreamOpenInfo } from '@defjs/core'

interface StreamApi<T> extends AsyncIterable<T>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}

const handle = null as unknown as EventStreamHandle<string>
const api: StreamApi<string> = handle
void api
```

Códigos terminales: `eof`, `aborted` o `error`. Un resultado `error` también lleva un `EventStreamFaultCode`: `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `RES_DECODE_FAILED` o `RES_MEDIA_TYPE_INVALID`.

`close(reason)` aborta el intento activo, cierra la cola y se asienta como `aborted`. Un `break` / `return` / throw del bucle invoca el return del iterador y cierra con `iterator-return`. El código que ejecuta el comando es dueño del cierre.

`await using` llama al mismo camino de cierre propietario y espera hasta que el trabajo de lectura/reconnect de Defjs se haya detenido y se haya liberado el reader lock activo. Está acotado a propósito alrededor de una promise de `ReadableStream.cancel()` controlada por el proveedor que nunca se asienta, así que no garantiza que esa promise del proveedor haya terminado. `stream.close(reason)` explícito más `await stream.closed` sigue siendo válido cuando necesitas un motivo o el resultado terminal.

Las implementaciones estructurales propias de `EventStreamHandle` ahora deben proporcionar `[Symbol.asyncDispose](): PromiseLike<void>` y conectarlo al mismo ciclo de vida. Es un cambio breaking en tiempo de compilación para quien implementa; quien solo recibe un handle de Defjs no necesita invocar nada nuevo en runtime.

El contrato mínimo de libs soportado y verificado en el repositorio es `ES2022`, `ESNext.Disposable`, `DOM` y `DOM.Iterable`, con el repositorio fijado a TypeScript 7. Estas cuatro entradas se verifican juntas como un único baseline; esto no afirma que cada declaración obligue por separado a cada entrada, y no se prometen compiladores más antiguos sin probar. Un cliente HTTP ordinario no es `AsyncDisposable`; gestiona cada solicitud con su timeout o `AbortSignal`.

Mantén credenciales, datos de evento, IDs de evento, causes y URL del stream fuera de los logs rutinarios. `withCredentials(true)` afecta a las cookies Fetch de SSE; no configura auth de WebSocket.

## Recetas relacionadas

- [Consumir un stream SSE](../recipes/consume-sse.md)
- [Cancelar una llamada HTTP](../recipes/cancel-http.md)
