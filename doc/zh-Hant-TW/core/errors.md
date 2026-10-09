---
title: Errors
description: 依一個封閉的 fault code 集合分支處理 404、逾時、讀不出來的 body 與傳輸失敗。
---

# Errors

處理 404、逾時或讀不出來的 body，靠的是讀 error-first tuple，而不是 catch 丟出的錯誤。`Fault` 是原生 `Error`（`instanceof Error` 為真），由一個欄位判別：`code`。

沒有 `kind`。失敗的類別就是 code 裡第一個 `_` 之前那一段，所以 `NET_TIMEOUT` 是 `NET` 類失敗，`RES_STRUCT_MISMATCH` 是 `RES` 類失敗。粗分看前綴，精確判斷看整個 code。

## 基本用法

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [err, user, response] = await client.execute(getUser({ id: 7 }))
if (err?.code === 'HTTP_STATUS' && err.status === 404) {
  console.log(err.data.message)
} else if (err?.code === 'NET_TIMEOUT') {
  console.log('timed out')
} else if (err?.code === 'RES_STRUCT_MISMATCH') {
  console.log('the response did not match what we declared', err.response.status)
} else if (!err) {
  console.log(user.name, response.status)
}
```

因為這個集合是封閉的，對 `code` 做 `switch` 能真正窮盡：

```typescript twoslash
import { createNetworkFault, ERR_ABORTED, type Fault } from '@defjs/core'

function triage(fault: Fault): string {
  switch (fault.code) {
    case 'HTTP_STATUS':
      return `status ${fault.status}`
    case 'RES_MEDIA_TYPE_INVALID':
    case 'RES_DECODE_FAILED':
    case 'RES_STRUCT_MISMATCH':
      return 'the contract did not hold'
    case 'NET_TIMEOUT':
    case 'NET_ABORTED':
    case 'NET_UNREACHABLE':
    case 'NET_BODY_INCOMPLETE':
      return 'retryable'
    case 'REQ_INPUT_INVALID':
    case 'REQ_OPTIONS_INVALID':
    case 'REQ_BUILD_FAILED':
      return 'fix the call'
    case 'EXT_INTERCEPTOR_FAILED':
    case 'EXT_HOOK_FAILED':
    case 'EXT_OBSERVER_FAILED':
      return 'fix the code you attached'
    case 'CAP_BUFFER_EXCEEDED':
    case 'CAP_QUEUE_OVERFLOW':
      return 'raise a declared limit or read faster'
    case 'ENV_UNSUPPORTED':
      return 'the host runtime is missing something'
  }
}

const example: Fault = createNetworkFault(ERR_ABORTED)
console.log(triage(example))
```

## 穩定的 code

| 類別   | Code                                                                   | 誰得改                         |
| ------ | ---------------------------------------------------------------------- | ------------------------------ |
| `HTTP` | `HTTP_STATUS`                                                          | 對端回了非 2xx；當業務邏輯處理 |
| `REQ`  | `REQ_INPUT_INVALID`、`REQ_OPTIONS_INVALID`、`REQ_BUILD_FAILED`         | 呼叫方，或端點宣告             |
| `NET`  | `NET_ABORTED`、`NET_TIMEOUT`、`NET_UNREACHABLE`、`NET_BODY_INCOMPLETE` | 沒人，或者重試                 |
| `RES`  | `RES_MEDIA_TYPE_INVALID`、`RES_DECODE_FAILED`、`RES_STRUCT_MISMATCH`   | 宣告和對端得對上               |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`、`EXT_HOOK_FAILED`、`EXT_OBSERVER_FAILED`     | 你掛到流水線上的程式碼         |
| `CAP`  | `CAP_BUFFER_EXCEEDED`、`CAP_QUEUE_OVERFLOW`                            | 宣告的上限，或者消費方的節奏   |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | 宿主執行環境                   |

集合是故意封閉的：這正是 `switch` 能窮盡的原因。擴充要報自己的細節就走 `cause`，不是加新 code。

### 各形狀帶哪些欄位

| Code          | `status` | `response`                                         | `data`                                |
| ------------- | -------- | -------------------------------------------------- | ------------------------------------- |
| `HTTP_STATUS` | 總是有   | 總是有；只有宣告過 `error` 且解碼成功時才帶 `body` | 解碼後的 `error` body，或 `undefined` |
| `RES_*`       | 總是有   | 總是有，只有 metadata——**沒有 `body`**             | 沒有                                  |
| 其餘一切      | 沒有     | 只有傳輸層當時已經拿到 metadata 時才有             | 沒有                                  |

`cause` 帶著底層的值：struct 不匹配時是 `StructError`，表示讀不出來時是 parser 的失敗，擴充丟什麼就是什麼。

## 各傳輸的 tuple 形狀

```typescript twoslash
import type {
  DecodedResponse,
  EventStreamHandle,
  EventStreamOpenInfo,
  Fault,
  HttpMeta,
  WebSocketConnectionInfo,
  WebSocketSession,
} from '@defjs/core'

type HttpResult =
  | [err: null, data: unknown, response: DecodedResponse<unknown> | HttpMeta]
  | [err: Fault, data: undefined, response: undefined]
type SseResult =
  | [err: null, stream: EventStreamHandle<unknown>, open: EventStreamOpenInfo]
  | [err: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]
type SocketResult =
  | [err: null, session: WebSocketSession<unknown>, connection: WebSocketConnectionInfo]
  | [err: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const results: [HttpResult, SseResult, SocketResult] | undefined = undefined
void results
```

HTTP 失敗時第三項是 `undefined`：當時存在的回應 metadata 已經由 fault 帶著了。這一點重要，因為你傳給 handler、寫 log、重新丟出的就是 fault，所以 metadata 必須跟著它走，而不是擺在它旁邊。

SSE 與 WebSocket 的第三項是啟動快照，即使啟動失敗也可能有。handle 或 session 回來之後，後續的失敗活在它自己的生命週期上——它們絕不改寫已經定下來的啟動 tuple。

## body 怎麼讀

`ok` 是唯一分流點，而且只有一邊會解碼。`output` 讀 2xx body；`error` 讀其餘一切。省略哪個，那個 body 就根本不會被讀。

| 情況                                  | 結果                                           |
| ------------------------------------- | ---------------------------------------------- |
| 2xx，宣告過 `output`，body 解碼成功   | 成功；`data` 與 `response.body` 都有型別       |
| 2xx，省略了 `output`                  | 成功；`data` 是 `undefined`，回應沒有 `body`   |
| 非 2xx，宣告過 `error`，body 解碼成功 | `HTTP_STATUS`，`data` 有型別                   |
| 非 2xx，省略了 `error`                | `HTTP_STATUS`，`data: undefined`               |
| 媒體類型不是那個表示需要的            | `RES_MEDIA_TYPE_INVALID`，在讀 body **之前**報 |
| bytes 不是那個表示                    | `RES_DECODE_FAILED`                            |
| 值不符合那個 struct                   | `RES_STRUCT_MISMATCH`                          |
| 你**沒有**宣告的那一側 body 讀不出來  | 整個忽略——見下                                 |

最後一列值得記住。如果你宣告了 `output` 而沒宣告 `error`，那麼一個 body 是壞 JSON 的 500，報出來是 `HTTP_STATUS` 加 `status: 500`。你說過你不在乎錯誤 body，這也包括不在乎它讀不出來這件事。

解碼只發生一次，而且在 interceptor 鏈之後。Interceptor 用 `makeResponse(...)` 造的回應，和線上來的走同一套媒體類型檢查、同一個 struct。

`HttpResponse.ok` 只表示 `200 <= status < 300`。傳輸失敗是 fault，絕不是回應——不存在代表它的 status-0 回應。

## 窄化錯誤 body 的聯集

一個 `error` struct 覆蓋所有非 2xx 狀態，所以形狀不同時你會宣告一個聯集。之後你能拿 `fault.data` 做什麼，完全取決於你怎麼宣告這個聯集——函式庫交還給你的，正是你要求的那個型別。

`struct.or(...)` 產出一個普通聯集，TypeScript 自己窄化不了。去測你要的那個欄位：

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` 按 body 真正帶著的欄位窄化。API 本身已經給錯誤打了標籤時，這是最舒服的寫法：

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('validation'), fields: struct.array(struct.string()) }),
  struct.object({ kind: struct.literal('rateLimit'), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS') {
  switch (fault.data.kind) {
    case 'validation':
      console.log(fault.data.fields.length)
      break
    case 'rateLimit':
      console.log(fault.data.retryAfter)
      break
  }
}
```

當 API 把狀態放在 body **裡面**時，就按它窄化，而不是按 `fault.status`：

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('status', [
  struct.object({ status: struct.literal(404), resource: struct.string() }),
  struct.object({ status: struct.literal(429), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && fault.data.status === 429) {
  console.log(fault.data.retryAfter)
}
```

只要 API 支援，最後這種寫法值得優先。`fault.status` 是 HTTP 層的數字，proxy、閘道器或 CDN 都能改寫它；而 `data.status` 是從你 `error` struct 斷言過的 body 裡解碼出來的，能取到它就是後端確實產出過它的證明。

一個不帶判別欄位、因此窄化不了的聯集，是宣告本身的性質，不是函式庫的——函式庫交給你的就是你宣告的型別。想要窄化，就給 struct 加一個判別欄位。

## 啟動期與開啟之後

SSE 在 resolve handle 之前會驗證狀態、`text/event-stream` 以及 body 是否存在。非 2xx → `HTTP_STATUS`。媒體類型不對 → `RES_MEDIA_TYPE_INVALID`。缺 body → `RES_DECODE_FAILED`。開啟快照照樣可能落在 tuple 第三項。

WebSocket 的啟動期覆蓋握手加第一次物理 open。建構器失敗、open 之前就關閉、逾時或取消，都會產出一個啟動 tuple。即使 socket 從沒到過 `open`，連線快照也可能存在。

| 傳輸      | 啟動之後                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| SSE       | 致命錯誤時 iterator reject；`stream.closed` 以 `kind: 'error'` 和對應的 fault `code` resolve                                      |
| WebSocket | 訊息／佇列／心跳失敗走 `onRuntimeError`；終止性錯誤讓 `receive` 失敗；`session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP      | execute 的 promise 只 settle 一次。Interceptor 和 callback 裡的程式碼仍可能在 tuple 正規化之外丟出錯誤                            |

`NET_ABORTED` / `NET_TIMEOUT` 描述的是呼叫方在啟動期看到了什麼。回傳給你的 stream 或 session，你照樣要關掉並 await 它的終態 promise。

## 原生 Error 的 log 與 cause

Fault 是原生 `Error` 實例，所以不需要診斷 adapter。`String(fault)` 給出穩定的原生形式 `DefjsFault: <message>`。`code` 和各變體欄位——`status`、`response`、`data`——保持可列舉，方便結構化 log；`name` 和原生 `cause` 鏈是不可列舉的。

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

呼叫 `format()`、`flatten()` 或 `prettify()` 之前，先把 `fault.cause` 窄化到 `StructError`。這些 helper 長在 Struct 的 cause 上，不會被複製到 fault 上。不要讓控制流去解析 `message` 或 `String(fault)`——契約是 `code` 和一個審過的 `status`。

## 參考

| 分支               | 控制流判斷                         | 好用的穩定欄位                         | 通常沒有／敏感              |
| ------------------ | ---------------------------------- | -------------------------------------- | --------------------------- |
| HTTP 狀態政策      | `fault.code === 'HTTP_STATUS'`     | `fault.status`、審過的 `fault.data`    | Body、headers、URL、`cause` |
| 呼叫方取消         | `fault.code === 'NET_ABORTED'`     | `code`                                 | 取消原因和堆疊              |
| 逾時               | `fault.code === 'NET_TIMEOUT'`     | `code`                                 | 請求 URL 和底層 cause       |
| 契約破了           | `fault.code.startsWith('RES_')`    | `code`、審過的 `fault.response.status` | Struct issue、body、輸入值  |
| 你自己的程式碼丟了 | `fault.code.startsWith('EXT_')`    | `code`、`cause`                        | 擴充掛上來的任何東西        |
| 流／工作階段執行期 | `stream.closed` / `session.closed` | 終態 `kind` 和 `code`                  | 事件負載、frame、cause      |

把 `cause`、`data`、回應 headers 和 body、URL、Struct issue、輸入值和堆疊都當敏感資訊。一個保守的摘要：

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`、`createPreflightFault`、`createDecodeFault`、`createHttpStatusFault` 和 `createUndecodedHttpStatusFault` 建構這些原生 Error 值。普通的請求失敗照樣在 tuple 裡回傳它們；不會因為它們繼承了原生 Error 行為就被丟出。`ERR_ABORTED` 和 `ERR_TIMEOUT` 是傳輸正規化器能認出來的共享 cause。

## 相關配方

- [宣告了 404 的 GET](../recipes/get-declared-404.md)
- [取消一次 HTTP 呼叫](../recipes/cancel-http.md)
