---
title: WebSocket
description: defineWebSocket、session，以及 execute options。
---

# WebSocket

宣告 socket、執行、收發型別化 messages，然後 close。

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`、一個 `incoming` struct、選填 `outgoing` struct、選填 `input`、`builder`、靜態 `protocols`、queue 限制。
- **回傳** endpoint。帶 input 呼叫就得到 `WebSocketCommand`。

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

`client.execute` 走的低階入口。寫功能時請走 client。

- **回傳** `[null, session, connection]` 或 `[error, undefined, connection?]`。

WebSocket execute 可以覆寫 `beforeConnect`、`heartbeat`、`protocols`、`reconnect`。

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

自有作用域優先用 `await using ownedSession = session` 清理。手動 `session.close()` 與 `await session.closed` 仍可使用。

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` 報告邏輯終止狀態。Async disposer 會要求原生 close 並等待 Defjs 自有 teardown；若持續沒有 close event，則以 1 秒為界，並可能用名為 `TimeoutError` 的 `DOMException` reject。它無法證明實體 TCP 連線已經關閉。

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`、`protocol`、`extensions`、`generation`（重連時遞增）。

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

socket 結束後的 close 快照（code、reason、clean flag、選填 cause）。手動 close 可以帶 `ManualSocketCloseReason`。

## 執行 options

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

`WebSocketHeartbeatConfig`：`intervalMs`、選填 `message`、`isAck`、`timeoutMs`。

設定了 `reconnect` 時，`attempts` 預設是 3；`0` 停用。省略 `attempts` 不是無限次。

## 訊息

`incoming` 是一個 struct。文字、`ArrayBuffer`、typed-array、`Blob` frames 會讀成 UTF-8，再 JSON parse，然後對這個 struct 檢查。JSON parse 或 struct 失敗的 frame 會報給 `session.onRuntimeError`，而且不會進 queue。沒有 client 端的 invalid-frame option。

`outgoing` 是一個 struct。`session.send` 接受該 struct 的 `StructInput`，編碼 aliases，再 `JSON.stringify`。多種訊息用 `struct.discriminatedUnion`。

```ts
session.send({ type: 'message', text: 'Hello' })
```

見 [WebSocket 指南](/core/web-socket) 與 [開啟 WebSocket session](/recipes/websocket-session)。

## WebSocketDefinition {#WebSocketDefinition}

`path`、`incoming`，可選 `outgoing`／`input`／`builder`／`protocols`，還有 queue 上限。Builder 只能回傳 `path` 與 `query`。

## WebSocketEndpoint {#WebSocketEndpoint}

`defineWebSocket` 的回傳值。帶 input 呼叫就得到 `WebSocketCommand`。

## WebSocketRequestShape {#WebSocketRequestShape}

只有 `path` 與 `query`。`headers` 與 `body` 是 `never`。

## WebSocketCommand {#WebSocketCommand}

不透明的 WebSocket command。丟給 `client.execute`。

## UseWebSocketConfig {#UseWebSocketConfig}

Heartbeat、reconnect、`beforeConnect`、protocols，再加上取消。`WebSocketExecuteOptions` 再加 `signal`。

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` 或 `[error, undefined, connection?]`。

## ManualSocketCloseReason {#ManualSocketCloseReason}

用 `session.close()` 關掉時記下的原因。

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`、選填 `message`、`isAck`、`timeoutMs`。

## WebSocketIncomingData {#WebSocketIncomingData}

解碼後的入站 frame：`incoming` struct 的 `Infer`。

## WebSocketOutgoingData {#WebSocketOutgoingData}

`session.send` 接受的值：`outgoing` struct 的 `StructInput`；沒宣告時是 `never`。

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

socket 結束後的終態快照。
