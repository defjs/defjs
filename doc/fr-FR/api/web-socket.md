---
title: WebSocket
description: defineWebSocket, session, et options d’execute.
---

# WebSocket

Déclare un socket, exécute-le, envoie et reçois des messages typés, puis ferme.

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`, un struct `incoming`, structs `outgoing` et `input` optionnels, `protocols` statiques optionnels, limites de queue. Un `input` déclaré exige toujours un `builder` explicite, même si l’entrée a déjà la forme de la requête. Seules les définitions sans `input` peuvent omettre `builder`.
- **Renvoie** un endpoint. Appelle avec l’entrée pour obtenir un `WebSocketCommand`.

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

Point d’entrée bas niveau pour `client.execute`. Préfère le client dans le code applicatif.

- **Renvoie** `[null, session, connection]` ou `[error, undefined, connection?]`.

L’execute WebSocket peut overrider `beforeConnect`, `heartbeat`, `protocols` et `reconnect`.

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

Préfère `await using ownedSession = session` pour le nettoyage d’une portée possédée. `session.close()` manuel et `await session.closed` restent disponibles.

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` rapporte l’état terminal logique. Le disposer async demande la fermeture native et attend le teardown possédé par Defjs, mais borne un événement de close manquant à une seconde et peut reject avec un `DOMException` nommé `TimeoutError`. Il ne peut pas prouver que la connexion TCP physique s’est fermée.

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`, `protocol`, `extensions`, `generation` (incrémente au reconnect).

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

Instantané de fermeture après la fin du socket (code, reason, flag clean, cause optionnelle). Une fermeture manuelle peut porter `ManualSocketCloseReason`.

## Options d’execute

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

`WebSocketHeartbeatConfig` : `intervalMs`, `message` optionnel, `isAck`, `timeoutMs`.

Quand `reconnect` est posé, `attempts` vaut 3 par défaut ; `0` désactive. Omettre `attempts` n’est pas illimité.

## Messages

`incoming` est un seul struct. Les frames texte, `ArrayBuffer`, typed-array et `Blob` sont lues en UTF-8, parsées en JSON, puis vérifiées contre ce struct. Une frame qui échoue au parse JSON ou au struct est rapportée à `session.onRuntimeError` et n’est pas mise en queue. Il n’y a pas d’option client pour les frames invalides.

`outgoing` est un seul struct. `session.send` accepte le `StructInput` de ce struct, encode les alias, puis `JSON.stringify`. Plusieurs kinds de messages sont un `struct.discriminatedUnion`.

```ts
session.send({ type: 'message', text: 'Hello' })
```

Voir le [guide WebSocket](/core/web-socket) et [Ouvrir une session WebSocket](/recipes/websocket-session).

## WebSocketDefinition {#WebSocketDefinition}

`path`, `incoming`, `outgoing` / `input` / `protocols` optionnels, limites de queue. Le builder ne peut renvoyer que `path` et `query`. Un `input` déclaré exige toujours un `builder` explicite, même si l’entrée a déjà la forme de la requête. Seules les définitions sans `input` peuvent omettre `builder`.

## WebSocketEndpoint {#WebSocketEndpoint}

Renvoyé par `defineWebSocket`. Appelle avec l’entrée pour obtenir un `WebSocketCommand`.

## WebSocketRequestShape {#WebSocketRequestShape}

`path` et `query` seulement. `headers` et `body` sont `never`.

## WebSocketCommand {#WebSocketCommand}

Commande WebSocket opaque. Passe-la à `client.execute`.

## UseWebSocketConfig {#UseWebSocketConfig}

Heartbeat, reconnect, `beforeConnect`, protocols, plus l’annulation. `WebSocketExecuteOptions` ajoute `signal`.

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` ou `[error, undefined, connection?]`.

## ManualSocketCloseReason {#ManualSocketCloseReason}

Raison enregistrée quand la session est fermée via `session.close()`.

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`, `message` optionnel, `isAck`, `timeoutMs`.

## WebSocketIncomingData {#WebSocketIncomingData}

Frame entrante décodée : `Infer` du struct `incoming`.

## WebSocketOutgoingData {#WebSocketOutgoingData}

Valeur acceptée par `session.send` : `StructInput` du struct `outgoing`, ou `never` quand aucun n’est déclaré.

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

Instantané de cycle de vie terminal après la fin du socket.
