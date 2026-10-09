---
title: Server-Sent Events
description: Typisierten SSE-Stream konsumieren, schließen und das Terminal-closed-Promise awaiten.
---

# Server-Sent Events

Öffne einen Stream, iteriere ihn, dann gib das owned Handle mit `await using` frei. Manuelles `close()` und `closed` bleiben verfügbar; Clients und Plugins disposen einen zurückgegebenen Stream nicht für dich.

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

## Stream definieren

`defineEventStream(...)` braucht `events`, positive Safe-Integer `maxBufferSize`, positive Safe-Integer `maxQueueSize` und einen relativen `path`. Method defaultet auf `GET`.

Die Request-Shape entspricht HTTP: optionaler `builder`, der `path`, `query`, `headers` und `body` zurückgibt. `GET` / `HEAD` können keinen Body zurückgeben. Ein deklarierter `error`-Struct typisiert den Startup-Fault und dekodiert einen Non-2xx-Handshake-Body nach Struct-Kind (`string` Text, `blob` / `file` Blob, `arrayBuffer` Bytes, sonst JSON). Defjs sendet `Accept: text/event-stream`, wenn du `Accept` nicht schon gesetzt hast.

Ein logischer Stream kann mehrere physische Fetch-Attempts umspannen, **wenn** du Reconnect opt-in machst. Ohne `withSSEReconnect` beenden transiente Network- und Stream-Read-Failures den logischen Stream. Du bekommst trotzdem ein Handle und einen Async-Iterator, wenn das Open gelingt.

## Öffnen und inspizieren

`client.execute(...)` resolved erst, nachdem Status-, Content-Type- und Body-Checks passen:

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

Response muss successful sein, Media-Type-Essence `text/event-stream` und einen Body haben. Non-2xx-Startup → `HTTP_STATUS`. Ist `error` deklariert, trägt dieser Fault den dekodierten Handshake-Body; ein schlechter Media-Type ist `RES_MEDIA_TYPE_INVALID`, und ein Body, der sich nicht als der deklarierte Kind lesen lässt, ist `RES_DECODE_FAILED`. Ein Response-Snapshot kann trotzdem im dritten Tupel-Slot sitzen, wenn Validierung nach Response-Ankunft failt.

`startupOpen` ist der initiale Snapshot. `stream.open` ist live und wechselt bei späteren physischen Opens. Behalte den Tupel-Wert, wenn die erste Response zählt.

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## Events dekodieren

Wire-Event-Name → `events[eventName]`; sonst `events.default`. Kein matching Struct → Event nicht delivered. Fehlendes SSE-`event`-Feld → logischer Name `message`.

SSE-`data` startet als Text. Ein `string`-Struct behält diesen Text. Jeder andere Kind ist JSON: Text parsen, dann mit dem Struct dekodieren. `struct.object`, `struct.number`, `struct.boolean`, `struct.any` und `struct.unknown` sind JSON, kein getrimmter Text. Ein bloßes Token wie `ping` erfüllt `struct.literal('ping')` nicht; die Data muss JSON sein. Ein Server, der den JSON-String `"abc"` sendet, erfüllt `struct.string()` weiterhin: der gelieferte Wert ist dieser Rohtext einschließlich der Anführungszeichen und wird nicht per JSON zu `abc` dekodiert.

Emittierter Wert: `event`, dekodiertes `data`, optionale non-empty `id`. Mit `default` sind unknown Event-Namen `string` in der inferierten Union.

## Invalid Events beobachten

Invalid/undeclared Events werden dropped, nicht gequeued. `withSSEOnInvalidEvent(...)` kann Raw-ID, Name, Text-Data plus `missing-struct` oder `validation-failed` und optional Cause beobachten.

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

Observer läuft an der Transform-Grenze. Sein Failure ist isoliert, außer das Active-Attempt-Signal ist aborted. Halte ihn kurz; behandle Raw-Event-Data nicht als trusted.

## Reconnect

**Behavior-Änderung:** SSE-Reconnect ist opt-in. Ohne `withSSEReconnect(...)` werden Network- und Stream-Read-Failures **nicht** retried (wie `attempts: 0`). Gib `withSSEReconnect({ attempts: 3 })` (oder ein anderes reviewed Budget), um diese Failures zu retryen. Normales EOF wird nicht retried. Status-/Content-Type-Validierung, Parser-Limits, Message-Transform-Failures, Queue-Overflow und normales EOF bleiben terminal für den logischen Stream.

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

`attempts` zählt Retries nach dem Initial-Attempt; Default ist `3`, wenn ein Reconnect-Object gesetzt ist. `attempts: 0` disabled Retry. `withSSEReconnect` weglassen disabled Retry ebenfalls. `delayMs` ist das initiale Interval; `factor` wächst es; `maxDelayMs` cappt die Base. SSE-`jitter` ist ein **multiplikativer Faktor von 0–1**, wie WebSocket. Ein Stream-`retry:`-Feld updated das aktuelle Interval. Ein Policy-Callback, der false zurückgibt / throwt / rejectet, endet den logischen Stream.

Die letzte geparste Event-ID wird `Last-Event-ID` auf einem späteren Attempt. Ein späterer Attempt sendet denselben Fetch-Request erneut, inklusive Method und Body. Kenn die Replay-Semantics des Servers, bevor du reconnectest.

## Buffer- und Queue-Limits

Beide müssen positive Safe Integers sein. Overflow ist fatal — kein silent Discard älterer Events.

| Limit           | Schützt                                                             | Terminal-Code         |
| --------------- | ------------------------------------------------------------------- | --------------------- |
| `maxBufferSize` | Incomplete/oversized SSE-Line/Event während Parsing                 | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | Events, die schneller produziert werden als der eine Consumer liest | `CAP_QUEUE_OVERFLOW`  |

Ein fataler Stream cleart auch buffered Events, cancelled den Active Body, rejectet den Iterator und resolved `stream.closed` mit `kind: 'error'`.

## Schließen und disposen

`EventStreamHandle`: ein live Opening-Snapshot, ein Terminal-Promise, ein `close`, ein Async-Iterator und ein Standard-Async-Disposer.

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

Terminal-Codes: `eof`, `aborted` oder `error`. Ein `error`-Result trägt auch ein `EventStreamFaultCode`: `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `RES_DECODE_FAILED` oder `RES_MEDIA_TYPE_INVALID`.

`close(reason)` abortet den Active Attempt, schließt die Queue, settled als `aborted`. Loop-`break` / `return` / Throw invokiert Iterator-Return und schließt mit `iterator-return`. Der Code, der den Command ausführt, besitzt Closure.

`await using` ruft denselben owned Close-Pfad auf und wartet, bis Defjs-Lese-/Reconnect-Arbeit gestoppt ist und der Active Reader-Lock freigegeben wurde. Es ist absichtlich um ein beim Provider hängendes `ReadableStream.cancel()`-Promise begrenzt, das nie settled, und garantiert deshalb nicht, dass so ein Provider-Promise fertig wurde. Explizites `stream.close(reason)` plus `await stream.closed` bleibt gültig, wenn du einen Grund oder das Terminal-Result brauchst.

Eigene strukturelle `EventStreamHandle`-Implementierungen müssen jetzt `[Symbol.asyncDispose](): PromiseLike<void>` liefern und ihn an denselben Lifecycle hängen. Das ist eine Compile-Time-Breaking-Änderung für Implementierer; Consumer, die nur ein Defjs-Handle empfangen, müssen zur Laufzeit nichts Neues aufrufen.

Der kleinste unterstützte und im Repository verifizierte Lib-Vertrag ist `ES2022`, `ESNext.Disposable`, `DOM` und `DOM.Iterable`, mit dem Repository auf TypeScript 7 gepinnt. Diese vier Einträge sind zusammen als eine Baseline verifiziert; das behauptet nicht, dass jede Declaration unabhängig jeden Eintrag erzwingt, und ungetestete ältere Compiler sind nicht zugesagt. Ein normaler HTTP-Client ist kein `AsyncDisposable`; verwalte jeden Request mit seinem Timeout oder `AbortSignal`.

Halte Credentials, Event-Data, Event-IDs, Causes und Stream-URLs aus Routine-Logs. `withCredentials(true)` betrifft Fetch-Cookies für SSE; es konfiguriert keine WebSocket-Auth.

## Verwandte Rezepte

- [SSE-Stream konsumieren](../recipes/consume-sse.md)
- [HTTP-Aufruf abbrechen](../recipes/cancel-http.md)
