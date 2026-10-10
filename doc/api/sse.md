---
title: SSE
description: defineEventStream, execute options, and the stream handle.
---

# SSE

Declare an event stream, execute it, iterate events, then close.

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`, `events` map, optional `method` (default `'GET'`), optional `input` and `error`, buffer/queue limits. A declared `input` always requires an explicit `builder`, even when it already matches the request shape. Only definitions without `input` may omit `builder`.
- **Returns** an endpoint. Call with input to get an `EventStreamCommand`.

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

Low-level entry for `client.execute`. Prefer the client in application code.

- **Returns** `[null, stream, open]` or `[error, undefined, open?]`. When `error` is declared, the fault is `Fault` of that struct; otherwise it is `Fault<undefined>`.

## Execute options

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

Same cancellation rules as HTTP: `abort` or `timeout`, not both.

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open` is the startup snapshot; after reconnect it can change — also read `stream.open`. Prefer `await using stream = handle` for owned scope cleanup. The disposer stops Defjs reading and reconnect work and waits for its reader lock to be released; it does not promise that a provider-controlled, stuck `ReadableStream.cancel()` promise will finish. Manual `close()` / `closed` remains available.

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

Structural implementations of `EventStreamHandle` must now implement `[Symbol.asyncDispose]()` and return the same owned teardown path. This is a compile-time breaking change for custom handles; code that only receives handles returned by Defjs has no new runtime call requirement.

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

## Event map

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

A `string` event struct keeps the raw `data` text. Every other kind is JSON text: `JSON.parse`, then the struct. A bare `struct.literal` therefore needs JSON text, not an unquoted token. Handshake `error` bodies use the same kind rule as HTTP: `string` is text, `blob` / `file` are blobs, `arrayBuffer` is bytes, and everything else is JSON.

Reconnect lives on the client (`withSSEReconnect`). SSE `jitter` is a **0–1 multiplicative factor**, same as WebSocket.

See [SSE guide](/core/sse) and [Consume an SSE stream](/recipes/consume-sse).

## EventStreamDefinition {#EventStreamDefinition}

`path`, `events`, optional `method` / `input` / `error`, buffer and queue limits. The request shape matches HTTP, including `body`. `GET` and `HEAD` cannot return a body. A declared `input` always requires an explicit `builder`, even when it already matches the request shape. Only definitions without `input` may omit `builder`.

## EventStreamEndpoint {#EventStreamEndpoint}

Returned by `defineEventStream`. Call with input to get an `EventStreamCommand`.

## EventStreamRequestShape {#EventStreamRequestShape}

Same fields as `HttpRequestShape` for the stream's method and path.

## EventStreamCommand {#EventStreamCommand}

Opaque SSE command. Pass to `client.execute`.

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` or `[error, undefined, open?]`.

## EventStreamData {#EventStreamData}

Parsed event payload inferred from an `EventStructs` map.
