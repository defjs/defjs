---
title: Server-Sent Events
description: 消費型別化的 SSE 串流，關閉它，並 await 終端的 closed promise。
---

# Server-Sent Events

開啟串流、迭代它，再用 `await using` 釋放自有 handle。手動 `close()` 與 `closed` 仍可使用；clients 與 plugins 不會替你 dispose 回傳的串流。

## Basic Setup

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: {
    message: struct.object({ text: struct.string() }),
  },
})

const [error, stream] = await client.execute(notifications())
if (error) {
  console.error(error.code)
} else {
  await using ownedStream = stream
  for await (const event of ownedStream) {
    if (event.event === 'message') console.log(event.data.text)
  }
}
```

## 定義串流

`defineEventStream(...)` 需要 `events`、正的 safe-integer `maxBufferSize`、正的 safe-integer `maxQueueSize`，以及相對 `path`。Method 預設是 `GET`。

Request 形狀跟 HTTP 一樣：選填的 `builder` 回傳 `path`、`query`、`headers`、`body`。`GET`／`HEAD` 不能回傳 body。宣告的 `error` struct 會給啟動 fault 定型，並依 struct kind 解碼非 2xx 的握手 body（`string` 是文字，`blob`／`file` 是 blob，`arrayBuffer` 是 bytes，其餘是 JSON）。你沒設 `Accept` 時，Defjs 會送 `Accept: text/event-stream`。

只有你選擇重連時，一個邏輯串流才可能跨多次實體 Fetch attempt。沒有 `withSSEReconnect`，暫時的網路與串流讀取失敗會結束邏輯串流。Open 成功時，你仍拿到一個 handle 與一個 async iterator。

## 開啟與檢查

`client.execute(...)` 只有在 status、content-type、body 檢查通過後才會 resolve：

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: { message: struct.string() },
})

const [error, stream, startupOpen] = await client.execute(notifications())
if (error) {
  console.error(error.code, startupOpen?.response.status)
} else {
  console.log(stream.open.response.status, startupOpen.response.status, stream.open.url)
  stream.close('example-finished')
  await stream.closed
}
```

回應必須成功、media type essence 是 `text/event-stream`，且有 body。非 2xx 啟動 → `HTTP_STATUS`。宣告了 `error` 時，那個 fault 帶著解碼後的握手 body；媒體類型不對是 `RES_MEDIA_TYPE_INVALID`，body 無法按宣告的 kind 讀取是 `RES_DECODE_FAILED`。回應抵達後驗證失敗時，第三格 tuple 仍可能放著回應快照。

`startupOpen` 是初始快照。`stream.open` 是 live 的，之後的實體 opens 會變。第一個回應重要時，留住 tuple 那個值。

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## 解碼事件

Wire event name → `events[eventName]`；否則 `events.default`。沒有相符 Struct → 事件不會交付。缺少 SSE `event` 欄位 → 邏輯名稱 `message`。

SSE `data` 一開始是文字。`string` struct 保留那段文字。其餘 kind 都是 JSON：先 parse 文字，再用 struct 解碼。`struct.object`、`struct.number`、`struct.boolean`、`struct.any`、`struct.unknown` 是 JSON，不是 trim 過的文字。像 `ping` 這種裸 token 不滿足 `struct.literal('ping')`；data 必須是 JSON。伺服器送出 JSON 字串 `"abc"` 時仍然滿足 `struct.string()`：交付的值就是那段原始文字，引號也在，不會 JSON 解碼成 `abc`。

發出的值：`event`、解碼後的 `data`、選填的非空 `id`。有 `default` 時，未知 event names 在推導的 union 裡是 `string`。

## 觀察無效事件

無效／未宣告事件會被丟掉，不會進 queue。`withSSEOnInvalidEvent(...)` 可觀察 raw ID、名稱、文字 data，以及 `missing-struct` 或 `validation-failed` 與選填 cause。

```ts
import { createClient, withEndpoint, withSSEOnInvalidEvent } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEOnInvalidEvent(({ reason, message, cause, signal }) => {
    if (signal.aborted) return
    console.info('Dropped SSE event', {
      reason,
      event: message.event,
      hasCause: cause !== undefined,
    })
  }),
)
```

Observer 跑在 transform 邊界。除非 active attempt signal 已 aborted，否則它的失敗是隔離的。保持短小；別把 raw event data 當可信資料。

## 重連

**行為變更：** SSE 重連是選擇性開啟。沒有 `withSSEReconnect(...)` 時，網路與串流讀取失敗**不會**重試（等同 `attempts: 0`）。傳 `withSSEReconnect({ attempts: 3 })`（或另一個審過的預算）才會重試那些失敗。正常 EOF 不會重試。Status／content-type 驗證、parser 限制、message transform 失敗、queue overflow、正常 EOF，對邏輯串流都是終端。

```ts
import { createClient, withEndpoint, withSSEReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEReconnect({
    attempts: 3,
    delayMs: 1_000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.5,
    shouldReconnect({ attempt, open }) {
      return attempt <= 3 && (open?.response.status ?? 0) !== 401
    },
  }),
)
```

`attempts` 計算初始 attempt 之後的重試；設定了 reconnect 物件時預設是 `3`。`attempts: 0` 停用重試。省略 `withSSEReconnect` 也會停用重試。`delayMs` 是起始間隔；`factor` 放大它；`maxDelayMs` 限制基數。SSE 的 `jitter` 是 **0–1 乘性因子**，跟 WebSocket 一樣。串流的 `retry:` 欄位會更新目前間隔。政策 callback 回傳 false／throw／reject 會結束邏輯串流。

最新剖析到的 event ID 會在之後的 attempt 變成 `Last-Event-ID`。之後的 attempt 會重送同一個 Fetch request，包括 method 與 body。重連前，先搞清楚伺服器的 replay 語意。

## Buffer 與 queue 限制

兩者都必須是正的 safe integers。Overflow 是致命的 — 不會默默丟掉較舊事件。

| 限制            | 保護什麼                             | 終端 code             |
| --------------- | ------------------------------------ | --------------------- |
| `maxBufferSize` | 剖析時不完整／過大的 SSE line／event | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | 事件產出快過單一消費者讀取           | `CAP_QUEUE_OVERFLOW`  |

致命串流也會清掉 buffered events、取消 active body、reject iterator，並以 `kind: 'error'` resolve `stream.closed`。

## Close 與 dispose

`EventStreamHandle`：一個 live opening 快照、一個終端 promise、一個 `close`、一個 async iterator，以及一個標準 async disposer。

```typescript twoslash
import type { EventStreamCloseInfo, EventStreamHandle, EventStreamOpenInfo } from '@defjs/core'

interface StreamApi<T> extends AsyncIterable<T>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}

const handle = null as unknown as EventStreamHandle<string>
const api: StreamApi<string> = handle
void api
```

終端 codes：`eof`、`aborted` 或 `error`。`error` 結果還帶 `EventStreamFaultCode`：`CAP_BUFFER_EXCEEDED`、`CAP_QUEUE_OVERFLOW`、`EXT_HOOK_FAILED`、`EXT_OBSERVER_FAILED`、`NET_TIMEOUT`、`NET_UNREACHABLE`、`RES_DECODE_FAILED` 或 `RES_MEDIA_TYPE_INVALID`。

`close(reason)` 會 abort active attempt、關閉 queue、以 `aborted` settle。迴圈 `break`／`return`／throw 會觸發 iterator return，並以 `iterator-return` 關閉。執行 command 的程式碼擁有關閉責任。

`await using` 會呼叫同一條自有 close 路徑，並等待 Defjs 讀取／重連工作停止，以及 active reader lock 釋放。如果 provider-controlled `ReadableStream.cancel()` promise 永久卡住，它不保證該 promise 完成。需要 reason 或終端結果時，仍可明確呼叫 `stream.close(reason)`，再 `await stream.closed`。

結構化實作 `EventStreamHandle` 的程式碼現在必須提供 `[Symbol.asyncDispose](): PromiseLike<void>`，並接到同一個 lifecycle。對實作者而言，這是編譯期 breaking change；只接收 Defjs handle 的 consumer 不必新增執行期呼叫。

儲存庫已驗證並支援的最低 lib 契約，是固定 TypeScript 7 加上 `ES2022`、`ESNext.Disposable`、`DOM`、`DOM.Iterable`。這四項組合是一個 baseline；不表示每份 declaration 都各自強制全部四項，也不承諾未經測試的舊 compiler。一般 HTTP Client 不是 `AsyncDisposable`，其請求應使用 timeout 或 `AbortSignal` 管理。

Credentials、event data、event IDs、causes、stream URLs 別進日常 logs。`withCredentials(true)` 影響 SSE 的 Fetch cookies；它不會設定 WebSocket auth。

## 相關 recipes

- [消費 SSE 串流](../recipes/consume-sse.md)
- [取消 HTTP 呼叫](../recipes/cancel-http.md)
