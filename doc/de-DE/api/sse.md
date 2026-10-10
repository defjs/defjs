---
title: SSE
description: defineEventStream, Execute-Options und das Stream-Handle.
---

# SSE

Deklariere einen Event-Stream, führe ihn aus, iteriere Events, dann schließe.

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`, `events`-Map, optionales `method` (Default `'GET'`), optionale `input` und `error`, Buffer-/Queue-Limits. Ein deklarierter `input` erfordert immer einen expliziten `builder`, auch wenn der Input bereits die Request-Shape hat. Nur Definitionen ohne `input` dürfen `builder` weglassen.
- **Returns** einen Endpoint. Ruf ihn mit Input auf und du bekommst einen `EventStreamCommand`.

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

Low-Level-Einstieg für `client.execute`. Im Application-Code lieber den Client nutzen.

- **Returns** `[null, stream, open]` oder `[error, undefined, open?]`. Ist `error` deklariert, ist der Fault ein `Fault` dieses Structs; sonst `Fault<undefined>`.

## Execute-Optionen

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

Dieselben Cancellation-Regeln wie HTTP: `abort` oder `timeout`, nicht beides.

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open` ist der Startup-Snapshot; nach Reconnect kann er wechseln — lies auch `stream.open`. Nutze lieber `await using stream = handle` für owned Scope-Cleanup. Der Disposer stoppt Defjs-Lese- und Reconnect-Arbeit und wartet, bis der Reader-Lock freigegeben ist; er verspricht nicht, dass ein beim Provider hängendes `ReadableStream.cancel()`-Promise fertig wird. Manuelles `close()` / `closed` bleibt verfügbar.

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

Strukturelle Implementierungen von `EventStreamHandle` müssen jetzt `[Symbol.asyncDispose]()` implementieren und denselben owned Teardown-Pfad zurückgeben. Das ist eine Compile-Time-Breaking-Änderung für eigene Handles; Code, der nur von Defjs zurückgegebene Handles empfängt, hat keine neue Runtime-Aufrufpflicht.

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

## Event-Map

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

Ein `string`-Event-Struct behält den rohen `data`-Text. Jeder andere Kind ist JSON-Text: `JSON.parse`, dann der Struct. Ein bloßes `struct.literal` braucht deshalb JSON-Text, kein unquoted Token. Handshake-`error`-Bodies nutzen dieselbe Kind-Regel wie HTTP: `string` ist Text, `blob` / `file` sind Blobs, `arrayBuffer` sind Bytes, alles andere ist JSON.

Reconnect lebt auf dem Client (`withSSEReconnect`). SSE-`jitter` ist ein **multiplikativer Faktor von 0–1**, genau wie bei WebSocket.

Siehe [SSE-Guide](/core/sse) und [SSE-Stream konsumieren](/recipes/consume-sse).

## EventStreamDefinition {#EventStreamDefinition}

`path`, `events`, optional `method` / `input` / `error`, plus Buffer- und Queue-Limits. Die Request-Shape entspricht HTTP, inklusive `body`. `GET` und `HEAD` können keinen Body zurückgeben. Ein deklarierter `input` erfordert immer einen expliziten `builder`, auch wenn der Input bereits die Request-Shape hat. Nur Definitionen ohne `input` dürfen `builder` weglassen.

## EventStreamEndpoint {#EventStreamEndpoint}

Kommt von `defineEventStream`. Mit Input aufrufen → `EventStreamCommand`.

## EventStreamRequestShape {#EventStreamRequestShape}

Dieselben Felder wie `HttpRequestShape` für Method und Path des Streams.

## EventStreamCommand {#EventStreamCommand}

Opakes SSE-Command. Gib es `client.execute`.

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` oder `[error, undefined, open?]`.

## EventStreamData {#EventStreamData}

Geparstes Event-Payload, inferiert aus einer `EventStructs`-Map.
