---
title: WebSocket
description: defineWebSocket、session，同 execute options。
---

# WebSocket

Declare 一個 socket，execute 佢，send/receive typed messages，之後 close。

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`、一個 `incoming` struct，可選 `outgoing` struct，可選 `input`、`builder`、static `protocols`、queue limits。
- **Returns** 一個 endpoint。用 input call 佢，就會得到 `WebSocketCommand`。

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

`client.execute` 嘅 low-level entry。Application code prefer 用 client。

- **Returns** `[null, session, connection]` 或者 `[error, undefined, connection?]`。

WebSocket execute 可以 override `beforeConnect`、`heartbeat`、`protocols` 同 `reconnect`。

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

自己 own 嘅 scope 優先用 `await using ownedSession = session` cleanup。Manual `session.close()` 同 `await session.closed` 仍然用得。

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` report 嘅係 logical terminal state。Async disposer 會 request native close，再等 Defjs-owned teardown；但如果一直收唔到 close event，就會 bound 喺一秒，亦可能用名為 `TimeoutError` 嘅 `DOMException` reject。佢證明唔到 physical TCP connection 已經 close。

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`、`protocol`、`extensions`、`generation`（reconnect 就會 increment）。

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

Socket 完咗之後嘅 close snapshot（code、reason、clean flag、optional cause）。Manual close 可以帶 `ManualSocketCloseReason`。

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

`WebSocketHeartbeatConfig`：`intervalMs`，可選 `message`、`isAck`、`timeoutMs`。

`reconnect` 有 set 嘅時候，`attempts` 預設係 3；`0` 就停用。唔寫 `attempts` 唔代表無限。

## Messages

`incoming` 係一個 struct。Text、`ArrayBuffer`、typed-array 同 `Blob` frames 會當 UTF-8 讀、`JSON.parse`，再對住個 struct 檢查。JSON parse 或者 struct 失敗嘅 frame 會報去 `session.onRuntimeError`，而且唔會入 queue。冇 client invalid-frame option。

`outgoing` 係一個 struct。`session.send` 接受嗰個 struct 嘅 `StructInput`，encode aliases，然後 `JSON.stringify`。幾種 message kinds 就用 `struct.discriminatedUnion`。

```ts
session.send({ type: 'message', text: 'Hello' })
```

睇 [WebSocket guide](/core/web-socket) 同 [Open a WebSocket session](/recipes/websocket-session)。

## WebSocketDefinition {#WebSocketDefinition}

`path`、`incoming`，可選 `outgoing` / `input` / `builder` / `protocols`，仲有 queue 上限。Builder 只可以 return `path` 同 `query`。

## WebSocketEndpoint {#WebSocketEndpoint}

`defineWebSocket` 嘅回傳。用 input call 一次就攞到 `WebSocketCommand`。

## WebSocketRequestShape {#WebSocketRequestShape}

只有 `path` 同 `query`。`headers` 同 `body` 係 `never`。

## WebSocketCommand {#WebSocketCommand}

Opaque WebSocket command。交畀 `client.execute`。

## UseWebSocketConfig {#UseWebSocketConfig}

Heartbeat、reconnect、`beforeConnect`、protocols，再加 cancellation。`WebSocketExecuteOptions` 再加 `signal`。

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` 或者 `[error, undefined, connection?]`。

## ManualSocketCloseReason {#ManualSocketCloseReason}

用 `session.close()` 閂嗰陣記低嘅 reason。

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`，可選 `message`、`isAck`、`timeoutMs`。

## WebSocketIncomingData {#WebSocketIncomingData}

解碼之後嘅 incoming frame：`incoming` struct 嘅 `Infer`。

## WebSocketOutgoingData {#WebSocketOutgoingData}

`session.send` 接受嘅 value：`outgoing` struct 嘅 `StructInput`；冇聲明就係 `never`。

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

socket 完咗之後嘅終態 lifecycle snapshot。
