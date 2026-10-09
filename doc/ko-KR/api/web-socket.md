---
title: WebSocket
description: defineWebSocket, session, 실행 options예요.
---

# WebSocket

소켓을 선언하고, 실행하고, 타입이 있는 메시지를 보내고 받은 뒤 닫아요.

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`, `incoming` struct 하나, 선택 `outgoing` struct, 선택 `input`, `builder`, 정적 `protocols`, queue 한도예요.
- **반환** 엔드포인트예요. 입력을 넣어 호출하면 `WebSocketCommand`가 나와요.

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

`client.execute`의 저수준 진입점이에요. 애플리케이션 코드에서는 클라이언트를 쓰는 편이 좋아요.

- **반환** `[null, session, connection]` 또는 `[error, undefined, connection?]`예요.

WebSocket 실행은 `beforeConnect`, `heartbeat`, `protocols`, `reconnect`를 덮어쓸 수 있어요.

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

소유한 범위를 정리할 때는 `await using ownedSession = session`을 선호해요. 수동 `session.close()`와 `await session.closed`도 그대로 쓸 수 있어요.

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed`는 논리적인 종료 상태를 보고해요. async disposer는 네이티브 close를 요청하고 Defjs가 소유한 teardown을 기다리지만, close 이벤트가 없으면 1초에서 끊고 `TimeoutError`라는 이름의 `DOMException`으로 reject할 수 있어요. 물리 TCP 연결이 닫혔다는 증명까지는 못 해요.

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`, `protocol`, `extensions`, `generation`(재연결할 때마다 증가)이에요.

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

소켓이 끝난 뒤의 close 스냅샷이에요 (code, reason, clean 플래그, 선택 cause). 수동 close는 `ManualSocketCloseReason`을 실을 수 있어요.

## 실행 options

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

`WebSocketHeartbeatConfig`: `intervalMs`, 선택 `message`, `isAck`, `timeoutMs`예요.

`reconnect`를 주면 `attempts` 기본값은 3이고, `0`은 꺼요. `attempts`를 빼도 무제한이 아니에요.

## 메시지

`incoming`은 struct 하나예요. 텍스트, `ArrayBuffer`, typed-array, `Blob` 프레임은 UTF-8로 읽고, JSON 파싱한 뒤 그 struct와 맞춰 봐요. JSON 파싱이나 struct에 실패한 프레임은 `session.onRuntimeError`로 보고되고 큐에 들어가지 않아요. 잘못된 프레임을 보는 클라이언트 옵션은 없어요.

`outgoing`은 struct 하나예요. `session.send`는 그 struct의 `StructInput`을 받고, alias를 인코딩한 뒤 `JSON.stringify`해요. 메시지 종류가 여러 개면 `struct.discriminatedUnion`이에요.

```ts
session.send({ type: 'message', text: 'Hello' })
```

[WebSocket 가이드](/core/web-socket)와 [WebSocket 세션 열기](/recipes/websocket-session)를 보세요.

## WebSocketDefinition {#WebSocketDefinition}

`path`, `incoming`, 선택 `outgoing` / `input` / `builder` / `protocols`, queue 한도예요. builder는 `path`와 `query`만 돌려줄 수 있어요.

## WebSocketEndpoint {#WebSocketEndpoint}

`defineWebSocket`이 돌려줘요. 입력을 넣어 호출하면 `WebSocketCommand`가 나와요.

## WebSocketRequestShape {#WebSocketRequestShape}

`path`와 `query`만 있어요. `headers`와 `body`는 `never`예요.

## WebSocketCommand {#WebSocketCommand}

opaque WebSocket 명령이에요. `client.execute`에 넘기세요.

## UseWebSocketConfig {#UseWebSocketConfig}

heartbeat, reconnect, `beforeConnect`, protocols, 그리고 취소예요. `WebSocketExecuteOptions`는 `signal`을 더해요.

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` 또는 `[error, undefined, connection?]`예요.

## ManualSocketCloseReason {#ManualSocketCloseReason}

`session.close()`로 세션을 닫을 때 기록되는 이유예요.

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`, 선택 `message`, `isAck`, `timeoutMs`예요.

## WebSocketIncomingData {#WebSocketIncomingData}

디코딩된 들어오는 프레임이에요. `incoming` struct의 `Infer`예요.

## WebSocketOutgoingData {#WebSocketOutgoingData}

`session.send`가 받는 값이에요. `outgoing` struct의 `StructInput`이고, 선언이 없으면 `never`예요.

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

소켓이 끝난 뒤의 종료 lifecycle 스냅샷이에요.
