---
title: WebSocket
description: defineWebSocket, session и опции execute.
---

# WebSocket

Объяви сокет, выполни, шли и принимай типизированные сообщения, потом закрой.

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`, один struct `incoming`, необязательный struct `outgoing`, необязательные `input`, `builder`, статические `protocols`, лимиты очереди.
- **Возвращает** эндпоинт. Вызови с input — получишь `WebSocketCommand`.

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

Низкоуровневый вход для `client.execute`. В прикладном коде бери клиент.

- **Возвращает** `[null, session, connection]` или `[error, undefined, connection?]`.

WebSocket execute может переопределить `beforeConnect`, `heartbeat`, `protocols` и `reconnect`.

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

Для cleanup принадлежащего scope предпочитай `await using ownedSession = session`. Ручные `session.close()` и `await session.closed` остаются.

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` сообщает логическое терминальное состояние. Async disposer просит нативный close и ждёт teardown, которым владеет Defjs, но ограничивает отсутствующее close-событие одной секундой и может reject’нуть `DOMException` с именем `TimeoutError`. Он не может доказать, что физическое TCP-соединение закрылось.

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`, `protocol`, `extensions`, `generation` (растёт на reconnect).

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

Снимок close после конца сокета (code, reason, clean flag, необязательный cause). Ручной close может нести `ManualSocketCloseReason`.

## Опции execute

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

`WebSocketHeartbeatConfig`: `intervalMs`, необязательные `message`, `isAck`, `timeoutMs`.

Когда `reconnect` задан, `attempts` по умолчанию 3; `0` отключает. Опустить `attempts` — это не «без лимита».

## Сообщения

`incoming` — один struct. Кадры text, `ArrayBuffer`, typed-array и `Blob` читаются как UTF-8, парсятся как JSON, потом проверяются этим struct. Кадр, который не прошёл JSON parse или struct, сообщается в `session.onRuntimeError` и в очередь не кладётся. Клиентской опции для невалидного кадра нет.

`outgoing` — один struct. `session.send` принимает `StructInput` этого struct, кодирует алиасы, потом `JSON.stringify`. Несколько видов сообщений — это `struct.discriminatedUnion`.

```ts
session.send({ type: 'message', text: 'Hello' })
```

См. [гайд WebSocket](/core/web-socket) и [Открыть WebSocket-сессию](/recipes/websocket-session).

## WebSocketDefinition {#WebSocketDefinition}

`path`, `incoming`, необязательные `outgoing` / `input` / `builder` / `protocols`, лимиты очереди. Builder может вернуть только `path` и `query`.

## WebSocketEndpoint {#WebSocketEndpoint}

То, что возвращает `defineWebSocket`. Вызови с input — получишь `WebSocketCommand`.

## WebSocketRequestShape {#WebSocketRequestShape}

Только `path` и `query`. `headers` и `body` — `never`.

## WebSocketCommand {#WebSocketCommand}

Непрозрачная WebSocket-команда. Отдай в `client.execute`.

## UseWebSocketConfig {#UseWebSocketConfig}

Heartbeat, reconnect, `beforeConnect`, protocols плюс отмена. `WebSocketExecuteOptions` добавляет `signal`.

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` или `[error, undefined, connection?]`.

## ManualSocketCloseReason {#ManualSocketCloseReason}

Reason, записанный, когда сессию закрыли через `session.close()`.

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`, необязательные `message`, `isAck`, `timeoutMs`.

## WebSocketIncomingData {#WebSocketIncomingData}

Декодированный входящий кадр: `Infer` struct `incoming`.

## WebSocketOutgoingData {#WebSocketOutgoingData}

Значение, которое принимает `session.send`: `StructInput` struct `outgoing`, или `never`, если он не объявлен.

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

Терминальный снимок lifecycle после конца сокета.
