---
title: WebSocket
description: defineWebSocket, session, and execute options.
---

# WebSocket

Declare a socket, execute it, send/receive typed messages, then close.

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`, one `incoming` struct, optional `outgoing` and `input` structs, optional static `protocols`, queue limits. A declared `input` always requires an explicit `builder`, even when it already matches the request shape. Only definitions without `input` may omit `builder`.
- **Returns** an endpoint. Call with input to get a `WebSocketCommand`.

```ts twoslash
import { defineWebSocket, struct } from '@defjs/core'

const chat = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  protocols: ['chat.v1'],
  incoming: struct.object({ text: struct.string(), type: struct.literal('message') }),
  outgoing: struct.object({ text: struct.string(), type: struct.literal('message') }),
})
```

## executeWebSocketCommand() {#executeWebSocketCommand}

```ts
function executeWebSocketCommand(
  clientConfig: ClientConfig,
  command: WebSocketCommand,
  options?: WebSocketExecuteOptions,
): Promise<SocketAwaitResult>
```

Low-level entry for `client.execute`. Prefer the client in application code.

- **Returns** `[null, session, connection]` or `[error, undefined, connection?]`.

WebSocket execute can override `beforeConnect`, `heartbeat`, `protocols`, and `reconnect`.

## WebSocketSession {#WebSocketSession}

```ts
interface WebSocketSession<TIncoming, TOutgoing> extends AsyncDisposable {
  readonly bufferedAmount: number
  readonly connection: WebSocketConnectionInfo
  readonly closed: Promise<WebSocketCloseInfo>
  readonly receive: AsyncIterable<TIncoming>
  readonly state: WebSocketState
  close(code?: number, reason?: string): void
  [Symbol.asyncDispose](): PromiseLike<void>
  send(message: TOutgoing): void
  onRuntimeError(listener: (error: unknown) => void): () => void
  onStateChange(listener: (state: WebSocketState) => void): () => void
}
```

Prefer `await using ownedSession = session` for owned scope cleanup. Manual `session.close()` and `await session.closed` remain available.

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` reports the logical terminal state. The async disposer requests native close and waits for Defjs-owned teardown, but bounds a missing close event at one second and may reject with a `DOMException` named `TimeoutError`. It cannot prove that the physical TCP connection closed.

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`, `protocol`, `extensions`, `generation` (increments on reconnect).

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

Close snapshot after the socket ends (code, reason, clean flag, optional cause). Manual close can carry `ManualSocketCloseReason`.

## Execute options

## WebSocketExecuteOptions {#WebSocketExecuteOptions}

```ts
type WebSocketExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
  beforeConnect?: (context: { attempt: number; signal: AbortSignal }) => void | Promise<void>
  protocols?: readonly string[]
  heartbeat?: WebSocketHeartbeatConfig
  reconnect?: ClientWebSocketOptions['reconnect']
}
```

`WebSocketHeartbeatConfig`: `intervalMs`, optional `message`, `isAck`, `timeoutMs`.

When `reconnect` is set, `attempts` defaults to 3; `0` disables. Omitting `attempts` is not unlimited.

## Messages

`incoming` is one struct. Text, `ArrayBuffer`, typed-array, and `Blob` frames are read as UTF-8, JSON-parsed, then checked against that struct. A frame that fails JSON parse or the struct is reported to `session.onRuntimeError` and is not queued. There is no client invalid-frame option.

`outgoing` is one struct. `session.send` accepts `StructInput` of that struct, encodes aliases, then `JSON.stringify`. Several message kinds are a `struct.discriminatedUnion`.

```ts
session.send({ type: 'message', text: 'Hello' })
```

See [WebSocket guide](/core/web-socket) and [Open a WebSocket session](/recipes/websocket-session).

## WebSocketDefinition {#WebSocketDefinition}

`path`, `incoming`, optional `outgoing` / `input` / `protocols`, queue limits. The builder may return `path` and `query` only. A declared `input` always requires an explicit `builder`, even when it already matches the request shape. Only definitions without `input` may omit `builder`.

## WebSocketEndpoint {#WebSocketEndpoint}

Returned by `defineWebSocket`. Call with input to get a `WebSocketCommand`.

## WebSocketRequestShape {#WebSocketRequestShape}

`path` and `query` only. `headers` and `body` are `never`.

## WebSocketCommand {#WebSocketCommand}

Opaque WebSocket command. Pass to `client.execute`.

## UseWebSocketConfig {#UseWebSocketConfig}

Heartbeat, reconnect, `beforeConnect`, protocols, plus cancellation. `WebSocketExecuteOptions` adds `signal`.

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` or `[error, undefined, connection?]`.

## ManualSocketCloseReason {#ManualSocketCloseReason}

Reason recorded when the session is closed via `session.close()`.

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`, optional `message`, `isAck`, `timeoutMs`.

## WebSocketIncomingData {#WebSocketIncomingData}

Decoded incoming frame: `Infer` of the `incoming` struct.

## WebSocketOutgoingData {#WebSocketOutgoingData}

Value accepted by `session.send`: `StructInput` of the `outgoing` struct, or `never` when none is declared.

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

Terminal lifecycle snapshot after the socket ends.
