---
title: WebSocket
description: defineWebSocket, sesión y opciones de execute.
---

# WebSocket

Declara un socket, ejecútalo, envía/recibe mensajes tipados y luego cierra.

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`, un struct `incoming`, structs `outgoing` e `input` opcionales, `protocols` estáticos opcionales, límites de cola. Declarar `input` siempre exige un `builder` explícito, aunque la entrada ya tenga la forma de la solicitud. Solo las definiciones sin `input` pueden omitir `builder`.
- **Devuelve** un endpoint. Llámalo con el input para obtener un `WebSocketCommand`.

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

Entrada de bajo nivel para `client.execute`. En la app prefiere el cliente.

- **Devuelve** `[null, session, connection]` o `[error, undefined, connection?]`.

El execute de WebSocket puede sobrescribir `beforeConnect`, `heartbeat`, `protocols` y `reconnect`.

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

Prefiere `await using ownedSession = session` para el cleanup del ámbito que posees. `session.close()` manual y `await session.closed` siguen disponibles.

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` reporta el estado terminal lógico. El disposer async pide el close nativo y espera el teardown que posee Defjs, pero acota un evento close ausente a un segundo y puede rechazar con una `DOMException` llamada `TimeoutError`. No puede demostrar que la conexión TCP física se cerró.

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`, `protocol`, `extensions`, `generation` (incrementa en reconnect).

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

Snapshot de cierre cuando termina el socket (code, reason, flag clean, cause opcional). Un close manual puede llevar `ManualSocketCloseReason`.

## Opciones de execute

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

`WebSocketHeartbeatConfig`: `intervalMs`, `message` opcional, `isAck`, `timeoutMs`.

Cuando `reconnect` está definido, `attempts` vale 3 por defecto; `0` lo desactiva. Omitir `attempts` no significa ilimitado.

## Mensajes

`incoming` es un struct. Los frames de texto, `ArrayBuffer`, typed array y `Blob` se leen como UTF-8, se parsean como JSON y luego se comprueban contra ese struct. Un frame que falla el parse JSON o el struct se reporta a `session.onRuntimeError` y no se encola. No hay opción de cliente para frames inválidos.

`outgoing` es un struct. `session.send` acepta el `StructInput` de ese struct, codifica los alias y luego hace `JSON.stringify`. Varios kinds de mensaje son un `struct.discriminatedUnion`.

```ts
session.send({ type: 'message', text: 'Hello' })
```

Mira la [guía de WebSocket](/core/web-socket) y [Abrir una sesión WebSocket](/recipes/websocket-session).

## WebSocketDefinition {#WebSocketDefinition}

`path`, `incoming`, `outgoing` / `input` / `protocols` opcionales, y límites de cola. El builder solo puede devolver `path` y `query`. Declarar `input` siempre exige un `builder` explícito, aunque la entrada ya tenga la forma de la solicitud. Solo las definiciones sin `input` pueden omitir `builder`.

## WebSocketEndpoint {#WebSocketEndpoint}

Lo devuelve `defineWebSocket`. Llámalo con input y sale un `WebSocketCommand`.

## WebSocketRequestShape {#WebSocketRequestShape}

Solo `path` y `query`. `headers` y `body` son `never`.

## WebSocketCommand {#WebSocketCommand}

Command WebSocket opaco. Pásaselo a `client.execute`.

## UseWebSocketConfig {#UseWebSocketConfig}

Heartbeat, reconnect, `beforeConnect`, protocols, más cancelación. `WebSocketExecuteOptions` añade `signal`.

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` o `[error, undefined, connection?]`.

## ManualSocketCloseReason {#ManualSocketCloseReason}

Razón que se guarda cuando la sesión se cierra con `session.close()`.

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`, `message` opcional, `isAck`, `timeoutMs`.

## WebSocketIncomingData {#WebSocketIncomingData}

Frame entrante decodificado: `Infer` del struct `incoming`.

## WebSocketOutgoingData {#WebSocketOutgoingData}

Valor que acepta `session.send`: `StructInput` del struct `outgoing`, o `never` si no se declaró ninguno.

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

Snapshot terminal del ciclo de vida cuando el socket ya acabó.
