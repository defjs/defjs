---
title: WebSocket
description: 開 typed JSON session，receive 同 send envelopes，之後 close 同 await closed。
---

# WebSocket

Start → receive → send → 用 `await using` release。Unsubscribe 同 disposal 係你 own。Manual `close()` / `closed` 仍然用得；clients、providers 同 interceptors 唔會 auto-close sessions。

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

## 每個方向一個 struct

`incoming` 係每條 text frame 嘅一個 struct。`outgoing` 係 `session.send(...)` 嘅一個 struct。幾種 kinds 用 `struct.discriminatedUnion` model。嗰啲 fields 上面嘅 alias 就係兩個方向嘅 wire name。冇獨立 type envelope，亦冇 normalizer。

```json
{ "type": "message", "text": "Hello" }
```

Incoming text、`ArrayBuffer`、typed-array 同 `Blob` frames 會當 UTF-8 讀、JSON-parsed，再對住 `incoming` 檢查。Malformed JSON 同 struct failures 去 `session.onRuntimeError`，而且唔會入 queue。Session 保持開住。唔係 text、bytes 或者 `Blob` 嘅 frames 會被 ignore。冇 `withWebSocketOnInvalidEvent`。

`session.send(...)` 會 synchronous validate 同 serialize：struct encode，然後 `JSON.stringify`。Open 時即刻 send；`reconnecting` 期間如果有 outgoing queue 就 queue；唔 writable 就 throw `InvalidStateError`。冇 outgoing struct、payload 過唔到 struct、outgoing queue disabled 或者 full，或者 native send 失敗，都會 throw。Definition 上面嘅 static `protocols` list 係 endpoint contract（例如 `graphql-transport-ws`）。Execute options 同 `withWebSocketProtocols` 仍然可以 override；token-in-subprotocol 屬於 `beforeConnect` 或者 interceptor，唔係 builder。Builder 只可以 return `path` 同 `query`。

`receive` 係 one-consumer。第二個 iterator 會被 reject。

## State snapshots

| Member                     | Meaning                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `state`                    | `idle`、`connecting`、`open`、`reconnecting`、`closing`、`closed`、`aborted` 或者 `error` |
| `connection`               | 最新 physical connection：`generation`、URL、negotiated protocol、有就有 extensions       |
| `bufferedAmount`           | Native unsent byte count；冇 physical socket 就係 `0`                                     |
| `receive`                  | Validated incoming messages 嘅 one-consumer async iterable                                |
| `onStateChange(listener)`  | Subscribe logical state transitions；return unsubscribe                                   |
| `onRuntimeError(listener)` | Subscribe non-startup runtime errors；return unsubscribe                                  |
| `closed`                   | Logical terminal close outcome 嘅 promise                                                 |

`open` = physical socket open。`reconnecting` 包括 replacement 之前嘅 preparation + delay。`connection.generation` 每逢一個 physical socket 到達 `open` 就 +1。Tuple `startupConnection` 保持第一個成功 snapshot；`session.connection` 會向前走。

Startup failure → `[error, undefined, connection?]`。Pre-open constructor failure 可能冇 connection；startup 期間嘅 timeout/close 仍然可能提供 snapshot。Session return 之後，runtime errors 經 observers、`receive` 同 `closed` 行 — 唔係第二次 execute tuple。

```typescript twoslash
import type { Fault, WebSocketConnectionInfo, WebSocketSession } from '@defjs/core'

type SocketResult<TIncoming, TOutgoing> =
  | [error: null, session: WebSocketSession<TIncoming, TOutgoing>, connection: WebSocketConnectionInfo]
  | [error: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const result: SocketResult<unknown, never> | undefined = undefined
void result
```

## Reconnect

Reconnect 係 opt-in。冇 `reconnect` object → physical close 完結 logical session。Configure 咗之後，defaults 係 `attempts: 3`、`delayMs: 1000`、`factor: 2`、`maxDelayMs: 30000`、`jitter: 0`。`attempts` 數嘅係 initial attempt 之後嘅 retries；`attempts: 0` 關閉。Default predicate 接受每個 close outcome。

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

`shouldReconnect` 拎 next retry attempt、close cause、code、reason 同 `wasClean`。Manual `session.close(...)` 唔入 predicate。Throwing preparation/policy 會以 error 完結 logical session。

WebSocket backoff jitter 係 **multiplicative**（`jitter: 0.2` → delay 喺 `0.8x` 到 `1.2x`）。SSE jitter 同 WebSocket 一樣，係 0–1 multiplicative factor。Delay/factor/jitter/attempt values 會喺 constructor 之前 validate；timer delays 唔可以超過 `2_147_483_647` ms。

`beforeConnect({ attempt, signal })` 喺 initial constructor 同每次 reconnect 之前 run。將佢嘅 signal 傳入 token refresh，等 cancel 同時停 prep 同 connect。

## Heartbeat

喺 execute 或者 client scope opt-in。Interval 會經 outgoing struct send `message()`。Optional `isAck(message)` 認 ack — 嗰條 message 會清 timeout，而且 **唔會** deliver 去 `receive`。

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

`intervalMs` 同 `timeoutMs` 一定要係 ≤ `2_147_483_647` 嘅 positive finite timers。Heartbeat message 一定要符合 outgoing struct。Serialization、native send、ack classification 同 timeout failures 對 logical session 係 fatal — 唔會變做 ordinary reconnects。

## Queues

| Setting                | Required value                                  | Behavior                                                                                         |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `maxIncomingQueueSize` | Positive safe integer                           | Bound 等 `receive` 嘅 parsed messages，同等 transform 嘅 raw frames。Overflow → `state: 'error'` |
| `maxOutgoingQueueSize` | Optional non-negative safe integer；default `0` | 淨係喺 `state === 'reconnecting'` 時 FIFO。Full/disabled → `send(...)` throw                     |

Queued outgoing frames 會喺 replacement socket publish `open` 之前 flush。已經喺舊 socket send 過嘅 frames 永遠唔會 auto-replay。Reconnect queues 用嚟裝你 reconnecting 期間 send 嘅 messages — 唔係 reconstruct app state。

Incoming overflow 會清 pending sequence、fail `receive`、停 session，再用 `kind: 'error'` resolve `session.closed`。Keep consumer 夠快，或者按 measured size/memory 提高 bound。

## Protocols 同 authentication

Definition `protocols`、client `withWebSocketProtocols(...)`，同 execute `protocols` 設定 constructor subprotocol list。Precedence：execution → client → definition。第一個 defined list 會 copy 畀 logical session，reconnect 時 reuse。

Browser WebSocket constructors 唔接受 arbitrary handshake headers，builder 亦唔可以 return `headers` 或者 `body`。Defjs 會將 `http:` → `ws:` 同 `https:` → `wss:`，path placeholders encode 一次，query rules 同 HTTP 一樣：預設係 scalars 同重複 keys，nested objects 用 `withQuerySerializer`，冇 query 就唔會 call serializer。

`withCredentials(true)` 係 HTTP/SSE 嘅 Fetch credentials — 唔係 WebSocket auth。用 reviewed cookie/session policy、subprotocol，或者 short-lived connection ticket。唔好將一般 credentials 或者 long-lived secrets 放 query string。

## Closure 同 ownership

`session.close(code?, reason?)` 要求 terminal closure 同停 heartbeat。Code 一定要係 `1000` 或者 `3000..4999`；reason ≤ 123 UTF-8 bytes。Invalid close args 會喺改 state 之前 throw。要 manual close reason 或 logical terminal result 時，同 `await session.closed` 一齊用。

```typescript twoslash
import type { WebSocketSession } from '@defjs/core'

async function observeSession(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  console.log(ownedSession.state)
}

void observeSession
```

`session.closed` 係 logical terminal snapshot：`'closed'`、`'aborted'` 或者 `'error'`，可選帶 native `code` / `reason` / `wasClean`，aborted/error 時仲有 `cause`。Observed native close fields 贏過 owner 要求嘅 fallback。

Standard async disposer 會 request best-effort native close，再等 Defjs-owned lifecycle、message-pump、timer、listener、queue 同 socket-reference teardown。假如 1 秒內都 observe 唔到 close event，teardown 會被 force，disposer 可能用名為 `TimeoutError` 嘅 `DOMException` reject；呢樣證明唔到 physical TCP connection 已經 close。重複 call disposer 會 share 同一個 teardown。自己 structural implement session 嘅 code，而家必須 provide 同一份 `[Symbol.asyncDispose](): PromiseLike<void>` contract。

## GraphQL boundary

Defjs 提供一個 incoming struct、一個 outgoing struct，同 logical session lifecycle。佢 **唔會** implement WebSocket application protocol。GraphQL-over-WebSocket features — connection init、operation IDs、`next`/`error`/`complete`、disposal、subscription replay — 都喺 core contract 之外。

Server 要求嗰個 protocol 時，用好似 `graphql-ws` 噉嘅 protocol client，或者用 `defineWebSocket(...)` model 嗰啲 frames。Static subprotocol 例如 `graphql-transport-ws` 放喺 `protocols`。淨係一個 struct 唔會 negotiate GraphQL semantics。

## Related recipes

- [Open a WebSocket session](../recipes/websocket-session.md)
- [Consume an SSE stream](../recipes/consume-sse.md)
