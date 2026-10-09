---
title: WebSocket
description: defineWebSocket, Session und Execute-Options.
---

# WebSocket

Deklariere einen Socket, führe ihn aus, sende/empfange typisierte Messages, dann schließe.

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`, ein `incoming`-Struct, optionaler `outgoing`-Struct, optionales `input`, `builder`, statische `protocols`, Queue-Limits.
- **Returns** einen Endpoint. Ruf ihn mit Input auf und du bekommst einen `WebSocketCommand`.

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

Low-Level-Einstieg für `client.execute`. Im Application-Code lieber den Client nutzen.

- **Returns** `[null, session, connection]` oder `[error, undefined, connection?]`.

WebSocket-Execute kann `beforeConnect`, `heartbeat`, `protocols` und `reconnect` überschreiben.

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

Nutze lieber `await using ownedSession = session` für owned Scope-Cleanup. Manuelles `session.close()` und `await session.closed` bleiben verfügbar.

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` meldet den logischen Terminal-Zustand. Der Async-Disposer fordert den nativen Close an und wartet auf Defjs-eigenen Teardown, begrenzt ein fehlendes Close-Event aber auf eine Sekunde und kann mit einer `DOMException` namens `TimeoutError` rejecten. Er kann nicht beweisen, dass die physische TCP-Verbindung geschlossen ist.

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`, `protocol`, `extensions`, `generation` (zählt bei Reconnect hoch).

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

Close-Snapshot, nachdem der Socket endet (code, reason, clean Flag, optionales cause). Manual Close kann `ManualSocketCloseReason` tragen.

## Execute-Optionen

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

`WebSocketHeartbeatConfig`: `intervalMs`, optionales `message`, `isAck`, `timeoutMs`.

Ist `reconnect` gesetzt, ist der Default für `attempts` 3; `0` schaltet aus. `attempts` weglassen heißt nicht unbegrenzt.

## Messages

`incoming` ist ein Struct. Text-, `ArrayBuffer`-, Typed-Array- und `Blob`-Frames werden als UTF-8 gelesen, JSON-geparst und dann gegen diesen Struct geprüft. Ein Frame, der JSON-Parse oder den Struct nicht besteht, geht an `session.onRuntimeError` und wird nicht gequeued. Es gibt keine Client-Option für invalid Frames.

`outgoing` ist ein Struct. `session.send` akzeptiert `StructInput` dieses Structs, encodet Aliasse, dann `JSON.stringify`. Mehrere Message-Kinds sind ein `struct.discriminatedUnion`.

```ts
session.send({ type: 'message', text: 'Hello' })
```

Siehe [WebSocket-Guide](/core/web-socket) und [WebSocket-Session öffnen](/recipes/websocket-session).

## WebSocketDefinition {#WebSocketDefinition}

`path`, `incoming`, optional `outgoing` / `input` / `builder` / `protocols`, Queue-Limits. Der Builder darf nur `path` und `query` zurückgeben.

## WebSocketEndpoint {#WebSocketEndpoint}

Kommt von `defineWebSocket`. Mit Input aufrufen → `WebSocketCommand`.

## WebSocketRequestShape {#WebSocketRequestShape}

Nur `path` und `query`. `headers` und `body` sind `never`.

## WebSocketCommand {#WebSocketCommand}

Opakes WebSocket-Command. Gib es `client.execute`.

## UseWebSocketConfig {#UseWebSocketConfig}

Heartbeat, Reconnect, `beforeConnect`, Protocols, plus Cancellation. `WebSocketExecuteOptions` legt `signal` drauf.

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` oder `[error, undefined, connection?]`.

## ManualSocketCloseReason {#ManualSocketCloseReason}

Grund, der landet, wenn die Session mit `session.close()` geschlossen wird.

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`, optional `message`, `isAck`, `timeoutMs`.

## WebSocketIncomingData {#WebSocketIncomingData}

Dekodierter Incoming-Frame: `Infer` des `incoming`-Structs.

## WebSocketOutgoingData {#WebSocketOutgoingData}

Wert, den `session.send` akzeptiert: `StructInput` des `outgoing`-Structs, oder `never`, wenn keiner deklariert ist.

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

Terminaler Lifecycle-Snapshot, nachdem der Socket endet.
