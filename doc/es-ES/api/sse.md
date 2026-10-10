---
title: SSE
description: defineEventStream, opciones de execute y el handle del stream.
---

# SSE

Declara un event stream, ejecútalo, itera los eventos y luego cierra.

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`, mapa `events`, `method` opcional (por defecto `'GET'`), `input` y `error` opcionales, límites de buffer/cola. Declarar `input` siempre exige un `builder` explícito, aunque la entrada ya tenga la forma de la solicitud. Solo las definiciones sin `input` pueden omitir `builder`.
- **Devuelve** un endpoint. Llámalo con el input para obtener un `EventStreamCommand`.

```ts twoslash
import { defineEventStream, struct } from '@defjs/core'

const ticks = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/ticks',
  events: { message: struct.object({ text: struct.string() }) },
})
```

## executeEventStreamCommand() {#executeEventStreamCommand}

```ts
function executeEventStreamCommand(
  clientConfig: ClientConfig,
  command: EventStreamCommand,
  options?: EventStreamExecuteOptions,
): Promise<StreamAwaitResult>
```

Entrada de bajo nivel para `client.execute`. En la app prefiere el cliente.

- **Devuelve** `[null, stream, open]` o `[error, undefined, open?]`. Cuando se declara `error`, el fault es `Fault` de ese struct; si no, es `Fault<undefined>`.

## Opciones de execute

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

Las mismas reglas de cancelación que HTTP: `abort` o `timeout`, no ambos.

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open` es el snapshot de arranque; tras reconnect puede cambiar — lee también `stream.open`. Prefiere `await using stream = handle` para el cleanup del ámbito que posees. El disposer detiene la lectura y el trabajo de reconnect de Defjs y espera a que se libere el reader lock; no promete que termine una promise de `ReadableStream.cancel()` atascada y controlada por el proveedor. `close()` / `closed` manuales siguen disponibles.

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

Las implementaciones estructurales de `EventStreamHandle` ahora deben implementar `[Symbol.asyncDispose]()` y devolver el mismo camino de teardown propietario. Es un cambio breaking en tiempo de compilación para handles propios; el código que solo recibe handles devueltos por Defjs no tiene un requisito nuevo de llamada en runtime.

### EventStreamOpenInfo {#EventStreamOpenInfo}

```ts
interface EventStreamOpenInfo {
  response: HttpResponse<unknown>
  url: string
}
```

### EventStreamCloseInfo {#EventStreamCloseInfo}

```ts
type EventStreamCloseInfo =
  | { kind: 'eof'; reason?: string; cause?: unknown }
  | { kind: 'aborted'; reason?: string; cause?: unknown }
  | { kind: 'error'; code: EventStreamFaultCode; reason?: string; cause?: unknown }
```

`EventStreamFaultCode`: `'CAP_BUFFER_EXCEEDED' | 'CAP_QUEUE_OVERFLOW' | 'EXT_HOOK_FAILED' | 'EXT_OBSERVER_FAILED' | 'NET_TIMEOUT' | 'NET_UNREACHABLE' | 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID'`.

## Mapa de eventos

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

Un struct de evento `string` conserva el texto crudo de `data`. Cualquier otro kind es texto JSON: `JSON.parse` y luego el struct. Un `struct.literal` suelto necesita por tanto texto JSON, no un token sin comillas. Los cuerpos `error` del handshake usan la misma regla de kind que HTTP: `string` es texto, `blob` / `file` son blobs, `arrayBuffer` son bytes y todo lo demás es JSON.

El reconnect vive en el cliente (`withSSEReconnect`). El `jitter` de SSE es un **factor multiplicativo 0–1**, igual que WebSocket.

Mira la [guía de SSE](/core/sse) y [Consumir un stream SSE](/recipes/consume-sse).

## EventStreamDefinition {#EventStreamDefinition}

`path`, `events`, `method` / `input` / `error` opcionales, y límites de buffer y cola. La forma de la solicitud coincide con HTTP, incluido `body`. `GET` y `HEAD` no pueden devolver un body. Declarar `input` siempre exige un `builder` explícito, aunque la entrada ya tenga la forma de la solicitud. Solo las definiciones sin `input` pueden omitir `builder`.

## EventStreamEndpoint {#EventStreamEndpoint}

Lo devuelve `defineEventStream`. Llámalo con input y sale un `EventStreamCommand`.

## EventStreamRequestShape {#EventStreamRequestShape}

Los mismos campos que `HttpRequestShape` para el method y el path del stream.

## EventStreamCommand {#EventStreamCommand}

Command SSE opaco. Pásaselo a `client.execute`.

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` o `[error, undefined, open?]`.

## EventStreamData {#EventStreamData}

Payload de evento parseado, inferido de un mapa `EventStructs`.
