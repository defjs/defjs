---
title: Server-Sent Events
description: Consume a typed SSE stream, close it, and await the terminal closed promise.
---

# Server-Sent Events

Open a stream, iterate it, then release the owned handle with `await using`. Manual `close()` and `closed` remain available; clients and plugins don’t dispose a returned stream for you.

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

## Define the stream

`defineEventStream(...)` needs `events`, positive safe-integer `maxBufferSize`, positive safe-integer `maxQueueSize`, and a relative `path`. Method defaults to `GET`.

The request shape matches HTTP: optional `builder` returning `path`, `query`, `headers`, and `body`. `GET` / `HEAD` cannot return a body. A declared `error` struct types the startup fault and decodes a non-2xx handshake body by struct kind (`string` text, `blob` / `file` blob, `arrayBuffer` bytes, otherwise JSON). Defjs sends `Accept: text/event-stream` when you didn’t already set `Accept`.

One logical stream can span several physical Fetch attempts **when** you opt into reconnect. Without `withSSEReconnect`, transient network and stream-read failures end the logical stream. You still get one handle and one async iterator when the open succeeds.

## Open and inspect

`client.execute(...)` resolves only after status, content-type, and body checks pass:

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

Response must be successful, media type essence `text/event-stream`, and have a body. Non-2xx startup → `HTTP_STATUS`. When `error` is declared, that fault carries the decoded handshake body; a bad media type is `RES_MEDIA_TYPE_INVALID` and a body that cannot be read as the declared kind is `RES_DECODE_FAILED`. A response snapshot can still sit in the third tuple slot when validation fails after the response arrives.

`startupOpen` is the initial snapshot. `stream.open` is live and changes on later physical opens. Keep the tuple value when the first response matters.

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## Decode events

Wire event name → `events[eventName]`; else `events.default`. No matching Struct → event not delivered. Missing SSE `event` field → logical name `message`.

SSE `data` starts as text. A `string` struct keeps that text. Every other kind is JSON: parse the text, then decode with the struct. `struct.object`, `struct.number`, `struct.boolean`, `struct.any`, and `struct.unknown` are JSON, not trimmed text. A bare token such as `ping` does not satisfy `struct.literal('ping')`; the data has to be JSON. A server that sends the JSON string `"abc"` still satisfies `struct.string()`: the delivered value is that raw text, including the quotes, and is not JSON-decoded to `abc`.

Emitted value: `event`, decoded `data`, optional non-empty `id`. With `default`, unknown event names are `string` in the inferred union.

## Observe invalid events

Invalid/undeclared events are dropped, not queued. `withSSEOnInvalidEvent(...)` can observe raw ID, name, text data, plus `missing-struct` or `validation-failed` and an optional cause.

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

Observer runs at the transform boundary. Its failure is isolated unless the active attempt signal is aborted. Keep it short; don’t treat raw event data as trusted.

## Reconnect

**Behavior change:** SSE reconnect is opt-in. Without `withSSEReconnect(...)`, network and stream-read failures are **not** retried (same as `attempts: 0`). Pass `withSSEReconnect({ attempts: 3 })` (or another reviewed budget) to retry those failures. Normal EOF is not retried. Status/content-type validation, parser limits, message transform failures, queue overflow, and normal EOF stay terminal for the logical stream.

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

`attempts` counts retries after the initial attempt; defaults to `3` when a reconnect object is set. `attempts: 0` disables retry. Omitting `withSSEReconnect` also disables retry. `delayMs` is the initial interval; `factor` grows it; `maxDelayMs` caps the base. SSE `jitter` is a **0–1 multiplicative factor**, same as WebSocket. A stream `retry:` field updates the current interval. Policy callback returning false / throwing / rejecting ends the logical stream.

Latest parsed event ID becomes `Last-Event-ID` on a later attempt. A later attempt resends the same Fetch request, including method and body. Know the server’s replay semantics before reconnecting.

## Buffer and queue limits

Both must be positive safe integers. Overflow is fatal — no silent discard of older events.

| Limit           | Protects                                           | Terminal code         |
| --------------- | -------------------------------------------------- | --------------------- |
| `maxBufferSize` | Incomplete/oversized SSE line/event while parsing  | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | Events produced faster than the one consumer reads | `CAP_QUEUE_OVERFLOW`  |

Fatal stream also clears buffered events, cancels the active body, rejects the iterator, and resolves `stream.closed` with `kind: 'error'`.

## Close and dispose

`EventStreamHandle`: one live opening snapshot, one terminal promise, one `close`, one async iterator, and one standard async disposer.

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

Terminal codes: `eof`, `aborted`, or `error`. An `error` result also carries an `EventStreamFaultCode`: `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `RES_DECODE_FAILED`, or `RES_MEDIA_TYPE_INVALID`.

`close(reason)` aborts the active attempt, closes the queue, settles as `aborted`. Loop `break` / `return` / throw invokes iterator return and closes with `iterator-return`. The code that executes the command owns closure.

`await using` calls the same owned close path and waits until Defjs reading/reconnect work has stopped and the active reader lock has been released. It is intentionally bounded around a provider-controlled `ReadableStream.cancel()` promise that never settles, so it does not guarantee that such a provider promise completed. Explicit `stream.close(reason)` plus `await stream.closed` is still valid when you need a reason or the terminal result.

Custom structural `EventStreamHandle` implementations must now provide `[Symbol.asyncDispose](): PromiseLike<void>` and connect it to the same lifecycle. That is a compile-time breaking change for implementers; consumers that only receive a Defjs handle do not need to invoke anything new at runtime.

The repository-validated and supported minimum lib contract is `ES2022`, `ESNext.Disposable`, `DOM`, and `DOM.Iterable`, with the repository pinned to TypeScript 7. These four entries are verified together as one baseline; this does not claim that every declaration independently forces every entry, and untested older compilers are not promised. An ordinary HTTP client is not `AsyncDisposable`; manage each request with its timeout or `AbortSignal`.

Keep credentials, event data, event IDs, causes, and stream URLs out of routine logs. `withCredentials(true)` affects Fetch cookies for SSE; it does not configure WebSocket auth.

## Related recipes

- [Consume an SSE stream](../recipes/consume-sse.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
