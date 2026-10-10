---
title: WebSocket
description: defineWebSocket、session，以及 execute options。
---

# WebSocket

声明一个 socket，execute，收发类型化消息，再 close。

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`、一个 `incoming` struct，可选 `outgoing` 和 `input` struct，可选静态 `protocols`、queue 上限。只要声明了 `input`，就必须显式提供 `builder`，即使输入已经是请求形状也一样。只有没有 `input` 的定义可以省略 `builder`。
- **返回** 一个 endpoint。塞 input 调用，得到 `WebSocketCommand`。

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

`client.execute` 的底层入口。业务代码走 client。

- **返回** `[null, session, connection]` 或 `[error, undefined, connection?]`。

WebSocket execute 可以覆盖 `beforeConnect`、`heartbeat`、`protocols`、`reconnect`。

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

自有作用域优先用 `await using ownedSession = session` 清理。手动 `session.close()` 和 `await session.closed` 仍可使用。

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` 报告逻辑终止状态。Async disposer 会请求原生 close 并等待 Defjs 自有 teardown；若一直没有 close event，则以 1 秒为界，并可能用名为 `TimeoutError` 的 `DOMException` reject。它无法证明物理 TCP 连接已经关闭。

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`、`protocol`、`extensions`、`generation`（重连就加一）。

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

socket 结束后的关闭快照（code、reason、clean 标记、可选 cause）。手动 close 可以带 `ManualSocketCloseReason`。

## 执行 options

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

`WebSocketHeartbeatConfig`：`intervalMs`，可选 `message`、`isAck`、`timeoutMs`。

设了 `reconnect` 时，`attempts` 默认 3；`0` 禁用。省略 `attempts` 不是无限次。

## 消息

`incoming` 是一个 struct。文本、`ArrayBuffer`、typed-array、`Blob` frame 都按 UTF-8 读，JSON parse，再拿这个 struct 校验。JSON parse 或 struct 失败的 frame 报到 `session.onRuntimeError`，不进队列。没有 client 级的非法 frame option。

`outgoing` 是一个 struct。`session.send` 接受该 struct 的 `StructInput`，编码 alias，再 `JSON.stringify`。好几种消息用 `struct.discriminatedUnion`。

```ts
session.send({ type: 'message', text: 'Hello' })
```

见 [WebSocket 指南](/core/web-socket) 和[打开 WebSocket 会话](/recipes/websocket-session)。

## WebSocketDefinition {#WebSocketDefinition}

`path`、`incoming`，可选 `outgoing` / `input` / `protocols`，还有 queue 上限。builder 只能返回 `path` 和 `query`。只要声明了 `input`，就必须显式提供 `builder`，即使输入已经是请求形状也一样。只有没有 `input` 的定义可以省略 `builder`。

## WebSocketEndpoint {#WebSocketEndpoint}

`defineWebSocket` 的返回值。拿 input 调一下就得到 `WebSocketCommand`。

## WebSocketRequestShape {#WebSocketRequestShape}

只有 `path` 和 `query`。`headers` 和 `body` 是 `never`。

## WebSocketCommand {#WebSocketCommand}

不透明的 WebSocket command。丢给 `client.execute`。

## UseWebSocketConfig {#UseWebSocketConfig}

heartbeat、reconnect、`beforeConnect`、protocols，再加上取消。`WebSocketExecuteOptions` 再加 `signal`。

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` 或 `[error, undefined, connection?]`。

## ManualSocketCloseReason {#ManualSocketCloseReason}

用 `session.close()` 关掉时记下的原因。

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`，可选 `message`、`isAck`、`timeoutMs`。

## WebSocketIncomingData {#WebSocketIncomingData}

解码后的入站 frame：`incoming` struct 的 `Infer`。

## WebSocketOutgoingData {#WebSocketOutgoingData}

`session.send` 接受的值：`outgoing` struct 的 `StructInput`；没声明时是 `never`。

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

socket 结束后的终态快照。
