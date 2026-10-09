---
title: WebSocket
description: defineWebSocket、session、execute options です。
---

# WebSocket

ソケットを宣言し、実行し、型付きメッセージを送受信してから閉じます。

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`、`incoming` struct 1 つ、任意の `outgoing` struct、任意の `input`、`builder`、静的な `protocols`、キュー上限です。
- **戻り値** エンドポイントです。入力を渡して呼ぶと `WebSocketCommand` になります。

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

`client.execute` の低レベル入口です。アプリコードではクライアントを使ってください。

- **戻り値** `[null, session, connection]`、または `[error, undefined, connection?]` です。

WebSocket の execute は `beforeConnect`、`heartbeat`、`protocols`、`reconnect` を上書きできます。

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

所有するスコープのクリーンアップには `await using ownedSession = session` を選んでください。手動の `session.close()` と `await session.closed` も残っています。

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` は論理的な終端状態を報告します。非同期 disposer はネイティブ close を要求し、Defjs が所有する teardown を待ちますが、close イベントが無い場合は 1 秒で打ち切り、`TimeoutError` という名前の `DOMException` で reject することがあります。物理 TCP 接続が閉じたことは証明できません。

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`、`protocol`、`extensions`、`generation`（再接続で増えます）。

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

ソケット終了後の close スナップショットです（code、reason、clean フラグ、任意の cause）。手動 close は `ManualSocketCloseReason` を持てます。

## 実行 options

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

`WebSocketHeartbeatConfig` は `intervalMs`、任意の `message`、`isAck`、`timeoutMs` です。

`reconnect` を置いたとき、`attempts` のデフォルトは 3 です。`0` は無効にします。`attempts` を省いても無制限にはなりません。

## メッセージ

`incoming` は struct 1 つです。テキスト、`ArrayBuffer`、typed-array、`Blob` のフレームは UTF-8 として読まれ、JSON パースされ、その struct に対して検査されます。JSON パースか struct に失敗したフレームは `session.onRuntimeError` に報告され、キューには入りません。クライアント側の不正フレーム option はありません。

`outgoing` は struct 1 つです。`session.send` はその struct の `StructInput` を受け、エイリアスをエンコードしてから `JSON.stringify` します。メッセージの種類が複数なら `struct.discriminatedUnion` です。

```ts
session.send({ type: 'message', text: 'Hello' })
```

[WebSocket ガイド](/core/web-socket) と [WebSocket セッションを開く](/recipes/websocket-session) を見てください。

## WebSocketDefinition {#WebSocketDefinition}

`path`、`incoming`、任意の `outgoing` / `input` / `builder` / `protocols`、キュー上限です。ビルダーが返せるのは `path` と `query` だけです。

## WebSocketEndpoint {#WebSocketEndpoint}

`defineWebSocket` の戻り値です。入力を渡して呼ぶと `WebSocketCommand` になります。

## WebSocketRequestShape {#WebSocketRequestShape}

`path` と `query` だけです。`headers` と `body` は `never` です。

## WebSocketCommand {#WebSocketCommand}

不透明な WebSocket コマンドです。`client.execute` に渡します。

## UseWebSocketConfig {#UseWebSocketConfig}

ハートビート、再接続、`beforeConnect`、protocols、それにキャンセルです。`WebSocketExecuteOptions` は `signal` を足します。

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` または `[error, undefined, connection?]` です。

## ManualSocketCloseReason {#ManualSocketCloseReason}

`session.close()` で閉じたときに記録される理由です。

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`、任意の `message`、`isAck`、`timeoutMs` です。

## WebSocketIncomingData {#WebSocketIncomingData}

デコードされた受信フレームです。`incoming` struct の `Infer` です。

## WebSocketOutgoingData {#WebSocketOutgoingData}

`session.send` が受け付ける値です。`outgoing` struct の `StructInput` で、宣言が無ければ `never` です。

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

ソケットが終わったあとの、終端ライフサイクルのスナップショットです。
