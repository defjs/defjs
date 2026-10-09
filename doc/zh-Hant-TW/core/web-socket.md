---
title: WebSocket
description: 啟動型別化的 JSON session、收發 envelopes，然後 close 並 await closed。
---

# WebSocket

啟動 → 接收 → 傳送 → 用 `await using` 釋放。Unsubscribe 與 disposal 由你負責。手動 `close()`／`closed` 仍可使用；clients、providers、interceptors 不會自動關閉 sessions。

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

`incoming` 是每一個文字 frame 的一個 struct。`outgoing` 是 `session.send(...)` 的一個 struct。多種訊息用 `struct.discriminatedUnion`。那些欄位上的 alias 就是雙向的 wire 名稱。沒有另外的 type envelope，也沒有 normalizer。

```json
{ "type": "message", "text": "Hello" }
```

進來的文字、`ArrayBuffer`、typed-array、`Blob` frames 會讀成 UTF-8，再 JSON parse，然後對 `incoming` 檢查。畸形 JSON 與 struct 失敗走 `session.onRuntimeError`，而且不會進 queue。Session 維持開著。不是文字、bytes 或 `Blob` 的 frames 會被忽略。沒有 `withWebSocketOnInvalidEvent`。

`session.send(...)` 同步驗證並序列化：先 struct encode，再 `JSON.stringify`。Open 時立刻送；有啟用 outgoing queue 時，在 `reconnecting` 期間會排隊；不可寫時丟 `InvalidStateError`。沒有 outgoing struct、payload 驗證失敗、停用／滿的 outgoing queue，或原生 send 失敗時也會 throw。定義上的靜態 `protocols` list 是 endpoint 契約（例如 `graphql-transport-ws`）。Execute options 與 `withWebSocketProtocols` 仍可覆寫它；把 token 放進 subprotocol 屬於 `beforeConnect` 或 interceptor，不屬於 builder。Builder 只能回傳 `path` 與 `query`。

`receive` 是單消費者。第二個 iterator 會被拒絕。

## State 快照

| Member                     | 意義                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `state`                    | `idle`、`connecting`、`open`、`reconnecting`、`closing`、`closed`、`aborted` 或 `error` |
| `connection`               | 最新實體連線：`generation`、URL、協商到的 protocol、可用時的 extensions                 |
| `bufferedAmount`           | 原生未送出的 byte 數；沒有實體 socket 時是 `0`                                          |
| `receive`                  | 單消費者的 async iterable，產出已驗證的進來訊息                                         |
| `onStateChange(listener)`  | 訂閱邏輯 state 轉換；回傳 unsubscribe                                                   |
| `onRuntimeError(listener)` | 訂閱非啟動的 runtime 錯誤；回傳 unsubscribe                                             |
| `closed`                   | 邏輯終端 close 結果的 Promise                                                           |

`open` = 實體 socket 已開。`reconnecting` 包含替換前的準備 + delay。`connection.generation` 在每個到達 `open` 的實體 socket 遞增。Tuple 的 `startupConnection` 維持第一次成功快照；`session.connection` 會往前走。

啟動失敗 → `[error, undefined, connection?]`。開之前的 constructor 失敗可能沒有 connection；啟動期間逾時／close 仍可能提供快照。Session 回傳後，runtime 錯誤走 observers、`receive`、`closed` — 不是第二次 execute tuple。

```typescript twoslash
import type { Fault, WebSocketConnectionInfo, WebSocketSession } from '@defjs/core'

type SocketResult<TIncoming, TOutgoing> =
  | [error: null, session: WebSocketSession<TIncoming, TOutgoing>, connection: WebSocketConnectionInfo]
  | [error: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const result: SocketResult<unknown, never> | undefined = undefined
void result
```

## 重連

重連是選擇性開啟。沒有 `reconnect` 物件 → 實體 close 結束邏輯 session。設定後，預設是 `attempts: 3`、`delayMs: 1000`、`factor: 2`、`maxDelayMs: 30000`、`jitter: 0`。`attempts` 計算初始 attempt 之後的重試；`attempts: 0` 關掉。預設 predicate 接受所有 close 結果。

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

`shouldReconnect` 拿到下一次重試 attempt、close cause、code、reason、`wasClean`。手動 `session.close(...)` 不會進 predicate。Preparation／政策 throw 會以錯誤結束邏輯 session。

WebSocket backoff jitter 是**乘法**（`jitter: 0.2` → delay 在 `0.8x` 與 `1.2x` 之間）。SSE jitter 是 0–1 乘性因子，跟 WebSocket 一樣。Delay／factor／jitter／attempt 值在 constructor 前驗證；timer delays 不能超過 `2_147_483_647` ms。

`beforeConnect({ attempt, signal })` 在初始 constructor 與每次重連前跑。把它的 signal 傳進 token refresh，讓取消同時停掉 prep 與 connect。

## Heartbeat

在 execute 或 client 範圍選擇性開啟。Interval 透過 outgoing struct 送 `message()`。選填的 `isAck(message)` 辨識 ack — 該訊息會清 timeout，且**不會**交付給 `receive`。

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

`intervalMs` 與 `timeoutMs` 必須是正的 finite timers，且 ≤ `2_147_483_647`。Heartbeat 訊息必須對 outgoing struct 有效。序列化、原生 send、ack 分類、逾時失敗對邏輯 session 是致命的 — 不會變成一般重連。

## Queues

| 設定                   | 必要值                            | 行為                                                                                           |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `maxIncomingQueueSize` | 正的 safe integer                 | 限制等著 `receive` 的已剖析訊息，以及等著 transform 的 raw frames。Overflow → `state: 'error'` |
| `maxOutgoingQueueSize` | 選填的非負 safe integer；預設 `0` | 只在 `state === 'reconnecting'` 時 FIFO。滿／停用 → `send(...)` throw                          |

排隊的 outgoing frames 會在替換 socket 發布 `open` 前 flush。已在較早 socket 送出的 frames 不會自動重放。重連 queues 是給你在重連期間送出的訊息 — 不是重建應用狀態用。

進來的 overflow 會清掉 pending sequence、讓 `receive` 失敗、停掉 session，並以 `kind: 'error'` resolve `session.closed`。讓消費者夠快，或依量測到的大小／記憶體提高上限。

## Protocols 與認證

定義的 `protocols`、client 的 `withWebSocketProtocols(...)`、execute 的 `protocols` 設定 constructor subprotocol list。優先序：execution → client → definition。第一個定義的 list 會複製給邏輯 session，並在重連時重用。

瀏覽器 WebSocket constructors 不接受任意 handshake headers，而且 builder 不能回傳 `headers` 或 `body`。Defjs 把 `http:` → `ws:`、`https:` → `wss:`，path placeholders encode 一次，並使用跟 HTTP 一樣的 query 規則：預設是 scalars 與重複的 keys，巢狀物件用 `withQuerySerializer`，沒有 query 時不呼叫 serializer。

`withCredentials(true)` 是 HTTP／SSE 的 Fetch credentials — 不是 WebSocket auth。用審過的 cookie／session 政策、subprotocol，或短效 connection ticket。別把一般憑證或長效 secrets 放進 query string。

## 關閉與擁有權

`session.close(code?, reason?)` 請求終端關閉並停掉 heartbeat。Code 必須是 `1000` 或 `3000..4999`；reason ≤ 123 UTF-8 bytes。無效的 close 參數會在改 state 前 throw。需要手動 close reason 或邏輯終端結果時，搭配 `await session.closed` 使用。

```typescript twoslash
import type { WebSocketSession } from '@defjs/core'

async function observeSession(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  console.log(ownedSession.state)
}

void observeSession
```

`session.closed` 是邏輯終端快照：`'closed'`、`'aborted'` 或 `'error'`，可帶選填的原生 `code`／`reason`／`wasClean`，以及 aborted／error 的 `cause`。觀察到的原生 close 欄位勝過擁有者請求的 fallback。

標準 async disposer 會要求 best-effort 原生 close，再等待 Defjs 自有 lifecycle、message pump、timers、listeners、queues 與 socket references teardown。若 1 秒內始終沒有觀察到 close event，teardown 會被強制完成，disposer 可能用名為 `TimeoutError` 的 `DOMException` reject；這無法證明實體 TCP 連線已經關閉。重複呼叫 disposer 會共用同一個 teardown。結構化實作 session 的程式碼現在必須提供同一份 `[Symbol.asyncDispose](): PromiseLike<void>` 契約。

## GraphQL 邊界

Defjs 提供一個 incoming struct、一個 outgoing struct，以及邏輯 session 生命週期。它**不會**實作 WebSocket 應用協定。GraphQL-over-WebSocket 功能 — connection init、operation IDs、`next`／`error`／`complete`、disposal、subscription replay — 都在核心契約之外。

伺服器要求該協定時，用像 `graphql-ws` 這類協定 client，或用 `defineWebSocket(...)` 建模 frames。把 `graphql-transport-ws` 這類靜態 subprotocol 放在 `protocols` 上。單靠 struct 協商不出 GraphQL 語意。

## 相關 recipes

- [開啟 WebSocket session](../recipes/websocket-session.md)
- [消費 SSE 串流](../recipes/consume-sse.md)
