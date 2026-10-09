---
title: WebSocket
description: Typisierte JSON-Session starten, Envelopes empfangen und senden, dann schließen und closed awaiten.
---

# WebSocket

Start → receive → send → mit `await using` freigeben. Du besitzt Unsubscribe und Disposal. Manuelles `close()` / `closed` bleibt verfügbar; Clients, Provider und Interceptors auto-schließen Sessions nicht.

## Basic Setup

```typescript twoslash
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
  outgoing: struct.object({ type: struct.literal('send'), text: struct.string() }),
})

const [error, session, startupConnection] = await client.execute(room())
if (error) {
  console.error(error.code, startupConnection?.generation)
} else {
  await using ownedSession = session
  const unsubscribe = ownedSession.onRuntimeError((cause) => console.error('runtime', cause))
  try {
    ownedSession.send({ type: 'send', text: 'Hello' })
    // wire: {"type":"send","text":"Hello"}
    for await (const message of ownedSession.receive) {
      console.log(message.type, message.text)
      break
    }
  } finally {
    unsubscribe()
  }
}
```

## Ein Struct pro Richtung

`incoming` ist ein Struct für jeden Text-Frame. `outgoing` ist ein Struct für `session.send(...)`. Modelle mehrere Kinds mit `struct.discriminatedUnion`. Alias auf diesen Fields ist der Wire-Name in beide Richtungen. Es gibt keinen separaten Type-Envelope und keinen Normalizer.

```json
{ "type": "message", "text": "Hello" }
```

Incoming Text-, `ArrayBuffer`-, Typed-Array- und `Blob`-Frames werden als UTF-8 gelesen, JSON-geparst und dann gegen `incoming` geprüft. Malformed JSON und Struct-Failures gehen an `session.onRuntimeError` und werden nicht gequeued. Die Session bleibt up. Frames, die weder Text noch Bytes noch ein `Blob` sind, werden ignoriert. Es gibt kein `withWebSocketOnInvalidEvent`.

`session.send(...)` validiert und serialisiert synchron: Struct-Encode, dann `JSON.stringify`. Es sendet sofort wenn open, queued während `reconnecting`, wenn eine Outgoing-Queue enabled ist, und throwt `InvalidStateError` wenn nicht writable. Es throwt auch, wenn es keinen Outgoing-Struct gibt, das Payload den Struct nicht besteht, die Outgoing-Queue disabled oder voll ist, oder der native Send failt. Eine statische `protocols`-Liste auf der Definition ist der Endpoint-Vertrag (zum Beispiel `graphql-transport-ws`). Execute-Options und `withWebSocketProtocols` können sie trotzdem überschreiben; ein Token-in-Subprotocol gehört in `beforeConnect` oder einen Interceptor, nicht in den Builder. Der Builder darf nur `path` und `query` zurückgeben.

`receive` ist One-Consumer. Ein zweiter Iterator wird rejected.

## State-Snapshots

| Member                     | Meaning                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `state`                    | `idle`, `connecting`, `open`, `reconnecting`, `closing`, `closed`, `aborted` oder `error`      |
| `connection`               | Latest physische Connection: `generation`, URL, negotiated Protocol, Extensions wenn verfügbar |
| `bufferedAmount`           | Native unsent Byte-Count, oder `0` ohne physischen Socket                                      |
| `receive`                  | One-Consumer Async-Iterable validierter Incoming-Messages                                      |
| `onStateChange(listener)`  | Logische State-Transitions abonnieren; gibt Unsubscribe zurück                                 |
| `onRuntimeError(listener)` | Non-Startup-Runtime-Errors abonnieren; gibt Unsubscribe zurück                                 |
| `closed`                   | Promise für das logische Terminal-Close-Outcome                                                |

`open` = physischer Socket open. `reconnecting` inkludiert Preparation + Delay vor einem Replacement. `connection.generation` inkrementiert jeden physischen Socket, der `open` erreicht. Tupel-`startupConnection` bleibt der erste erfolgreiche Snapshot; `session.connection` bewegt sich vorwärts.

Startup-Failure → `[error, undefined, connection?]`. Pre-Open-Constructor-Failure kann keine Connection haben; Timeout/Close während Startup kann trotzdem ein Snapshot liefern. Nach Session-Return reisen Runtime-Errors durch Observer, `receive` und `closed` — nicht durch ein zweites Execute-Tupel.

```typescript twoslash
import type { Fault, WebSocketConnectionInfo, WebSocketSession } from '@defjs/core'

type SocketResult<TIncoming, TOutgoing> =
  | [error: null, session: WebSocketSession<TIncoming, TOutgoing>, connection: WebSocketConnectionInfo]
  | [error: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const result: SocketResult<unknown, never> | undefined = undefined
void result
```

## Reconnect

Reconnect ist opt-in. Kein `reconnect`-Object → physisches Close endet die logische Session. Wenn konfiguriert, sind Defaults `attempts: 3`, `delayMs: 1000`, `factor: 2`, `maxDelayMs: 30000`, `jitter: 0`. `attempts` zählt Retries nach dem Initial-Attempt; `attempts: 0` disabled. Default-Predicate akzeptiert jedes Close-Outcome.

```ts
import { createClient, defineWebSocket, struct, withEndpoint, withWebSocketReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://chat.example.com'),
  withWebSocketReconnect({
    attempts: 3,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldReconnect({ attempt, code, wasClean }) {
      return attempt <= 3 && (wasClean !== true || code === 1006)
    },
  }),
)
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
})
const [error, session] = await client.execute(room())
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`shouldReconnect` bekommt next Retry-Attempt, Close-Cause, Code, Reason und `wasClean`. Manuelles `session.close(...)` betritt das Predicate nicht. Throwende Preparation/Policy endet die logische Session mit Error.

WebSocket-Backoff-Jitter ist **multiplicative** (`jitter: 0.2` → Delay zwischen `0.8x` und `1.2x`). SSE-Jitter ist ein multiplikativer Faktor von 0–1, wie WebSocket. Delay-/Factor-/Jitter-/Attempt-Values werden vor dem Constructor validiert; Timer-Delays können `2_147_483_647` ms nicht überschreiten.

`beforeConnect({ attempt, signal })` läuft vor dem Initial-Constructor und jedem Reconnect. Gib sein Signal in Token-Refresh, damit Cancel Prep und Connect stoppt.

## Heartbeat

Opt-in auf Execute- oder Client-Scope. Interval sendet `message()` durch den Outgoing-Struct. Optionales `isAck(message)` erkennt ein Ack — diese Message cleart den Timeout und wird **nicht** an `receive` delivered.

```ts
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.discriminatedUnion('type', [struct.object({ type: struct.literal('pong'), ok: struct.boolean() })]),
  outgoing: struct.object({ type: struct.literal('ping') }),
})

const [error, session] = await client.execute(room(), {
  heartbeat: {
    intervalMs: 30_000,
    timeoutMs: 10_000,
    message: () => ({ type: 'ping' }),
    isAck: (message) => message.type === 'pong',
  },
})
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`intervalMs` und `timeoutMs` müssen positive finite Timer ≤ `2_147_483_647` sein. Heartbeat-Message muss für den Outgoing-Struct gültig sein. Serialization-, Native-Send-, Ack-Classification- und Timeout-Failures sind fatal für die logische Session — sie werden keine ordinary Reconnects.

## Queues

| Setting                | Required Value                                  | Behavior                                                                                                                   |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `maxIncomingQueueSize` | Positive Safe Integer                           | Boundet geparste Messages, die auf `receive` warten, und Raw Frames, die auf Transform warten. Overflow → `state: 'error'` |
| `maxOutgoingQueueSize` | Optional non-negative Safe Integer; Default `0` | FIFO nur während `state === 'reconnecting'`. Full/disabled → `send(...)` throwt                                            |

Queued Outgoing-Frames flushen, bevor der Replacement-Socket `open` published. Frames, die schon auf einem früheren Socket gesendet wurden, werden nie auto-replayed. Reconnect-Queues sind für Messages, die du während Reconnecting sendest — nicht zum Reconstructing von App-State.

Incoming-Overflow cleart die Pending Sequence, failt `receive`, stoppt die Session, resolved `session.closed` mit `kind: 'error'`. Halte den Consumer schnell genug oder erhöhe das Bound aus measured Size/Memory.

## Protocols und Authentication

Definition-`protocols`, Client-`withWebSocketProtocols(...)` und Execute-`protocols` setzen die Constructor-Subprotocol-List. Precedence: Execution → Client → Definition. Die erste definierte List wird für die logische Session kopiert und auf Reconnect reused.

Browser-WebSocket-Constructors akzeptieren keine beliebigen Handshake-Headers, und der Builder kann weder `headers` noch `body` zurückgeben. Defjs konvertiert `http:` → `ws:` und `https:` → `wss:`, encoded Path-Placeholder einmal und nutzt dieselben Query-Regeln wie HTTP: Scalars und wiederholte Keys per Default, `withQuerySerializer` für genestete Objects, und kein Serializer-Aufruf, wenn es keine Query gibt.

`withCredentials(true)` ist Fetch-Credentials für HTTP/SSE — nicht WebSocket-Auth. Nutze reviewed Cookie-/Session-Policy, Subprotocol oder ein short-lived Connection-Ticket. Packe keine allgemeinen Credentials oder long-lived Secrets in den Query String.

## Closure und Ownership

`session.close(code?, reason?)` requestet Terminal-Closure und stoppt Heartbeat. Code muss `1000` oder `3000..4999` sein; Reason ≤ 123 UTF-8 Bytes. Invalid Close-Args throwen vor State-Änderung. Nutze es mit `await session.closed`, wenn du einen manuellen Close-Grund oder das logische Terminal-Result brauchst.

```typescript twoslash
import type { WebSocketSession } from '@defjs/core'

async function observeSession(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  console.log(ownedSession.state)
}

void observeSession
```

`session.closed` ist der logische Terminal-Snapshot: `'closed'`, `'aborted'` oder `'error'`, mit optionalem native `code` / `reason` / `wasClean` und einem `cause` für Aborted/Error. Observed native Close-Fields gewinnen über den vom Owner requested Fallback.

Der Standard-Async-Disposer fordert Best-Effort native Close an und wartet dann auf Defjs-eigenen Lifecycle-, Message-Pump-, Timer-, Listener-, Queue- und Socket-Reference-Teardown. Wird innerhalb einer Sekunde kein Close-Event beobachtet, wird Teardown erzwungen und der Disposer kann mit einer `DOMException` namens `TimeoutError` rejecten; das beweist nicht, dass die physische TCP-Verbindung geschlossen ist. Wiederholte Disposer-Aufrufe teilen denselben Teardown. Eigene strukturelle Session-Implementierungen müssen jetzt denselben `[Symbol.asyncDispose](): PromiseLike<void>`-Vertrag liefern.

## GraphQL-Grenze

Defjs liefert einen Incoming-Struct, einen Outgoing-Struct und einen logischen Session-Lifecycle. Es implementiert **kein** WebSocket-Application-Protocol. GraphQL-over-WebSocket-Features — Connection-Init, Operation-IDs, `next`/`error`/`complete`, Disposal, Subscription-Replay — liegen außerhalb des Core-Vertrags.

Nutze einen Protocol-Client wie `graphql-ws`, wenn der Server dieses Protocol verlangt, oder modele die Frames mit `defineWebSocket(...)`. Packe ein statisches Subprotocol wie `graphql-transport-ws` auf `protocols`. Ein Struct allein negotiiert keine GraphQL-Semantics.

## Verwandte Rezepte

- [WebSocket-Session öffnen](../recipes/websocket-session.md)
- [SSE-Stream konsumieren](../recipes/consume-sse.md)
