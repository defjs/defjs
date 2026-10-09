---
title: Design decisions
description: 點解 Defjs 要將 contracts、commands、transport results、decoding 同 ownership 寫得咁明確。
---

# Design decisions

Defjs 刻意做咗幾個 trade-offs。Convenience APIs 好多時會隱藏邊個 own 住 request、stream 或者 session。Defjs 要呢條 boundary 睇得見，等你可以 reuse 同一個 endpoint contract，又唔會靜靜雞拎住 cache、retry scheduler 或者 resource manager。

## 聲明即斷言 {#declaration-is-an-assertion}

呢六條規則決定咗「response 點讀」嘅所有問題。編咗號，方便日後討論時直接引用，唔使重新推導一次。

### 1. 你聲明嘅就係你斷言嘅

`output` 嘅意思係「`ok` 係 true 嘅時候，body **就係**呢個形狀」。`error` 嘅意思係「`ok` 係 false 嘅時候，body **就係**呢個形狀」。聲明唔係提示，亦唔係盡力而為嘅期望，而係對「會收到啲咩」嘅斷言。

### 2. `ok` 係唯一分流點，而且只走一邊

2xx 用 `output` 讀。其他一律用 `error` 讀。絕對唔會兩邊都試，亦唔會拿另一邊嚟墊底。

### 3. 現實同斷言唔一致就係失敗，而且要明確報

唔猜 format、唔降級、唔靜靜雞。係後端改咗、gateway 插手，抑或有人改過個 response，**都唔影響結論**——library 分唔出，亦唔應該裝到分得出。

呢條最多人想放寬，所以值得將情況講清楚。假設有個壞蛋可以改寫你個頁面本應按 `output` 解析嘅 `200`，而你收到嘅係 `3xx`、`4xx` 或者 `5xx`。報錯唔係麻煩，而係唯一安全嘅結果。「以防萬一」將原始 body 交俾你，等於俾任何可以注入 response 嘅人一條路，繞過你自己要求嘅 validation。

### 4. 解碼失敗就冇 body

body **就係**解碼之後嘅值。解碼失敗就冇值——唔存在半成品 body 俾你睇。出錯細節喺 `cause` 上面；response 只保留 metadata，其他冇。

呢條由 type system 強制，唔靠約定：解碼 fault 嘅 `response` 係 `HttpMeta`，根本冇 `body` field，去拿佢就係 compile error。

### 5. 唔想被斷言綁住，就唔好聲明

唔寫 `output` 意思係「我唔關心 2xx 嘅 body」——佢根本唔會被讀。唔寫 `error` 對其餘 status 同理。呢個係明示 opt-out，唔係漏咗，而且徹底：你 opt out 嗰一邊嘅 body 讀唔出，唔係你嘅事，連「佢讀唔出」呢件事本身都唔係。

### 6. 3xx 唔係 error code 區間

如果你知道某個 endpoint 會回 redirect status，就唔好俾 `output` 傳對應嘅 schema，或者聲明一個接受空值嘅 schema。否則報錯係預期結果，唔係缺陷。

## Explicit clients

`createClient(...)` 將 endpoint config 變成一個明確嘅 value。唔同 environment 或者 request scope 用唔同 endpoints、credentials、interceptors、serializers 同 transport handles。

代價：冇 process-wide default。呢個代價喺 server 上面好有用 — 當 options 或者 closures capture auth、cookies、users、tenants 或者 request metadata 時，喺 request boundary 入面 create client。Explicit client 仍然唔會 isolate interceptor capture 嘅 state。Client identity 本身唔係 security boundary。

Client 負責 dispatch commands。佢唔 own 住 active work。邊個開始 HTTP request、SSE stream 或者 WebSocket session，就要 cancel 或者 close，再 await terminal promise。

## Definitions、endpoints 同 commands

Definition 係穩定嘅 contract：method、path、input struct、decode `ok` 兩邊嘅 structs、transport limits。`defineRequest` return 一個 endpoint。Call 佢會為單次 execution create 一個 opaque command。

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const command = getUser({ id: 7 })
```

Background job 同 UI owner 可以用唔同 cancel/retry policy 去 execute 同一個 `getUser` 形狀。Command 保持 opaque，就唔會令 app code 依賴 internal transport tags 或者 symbols。

## Transport-specific results

三種傳輸都用 error-first tuple。如果淨係一個 generic「response」，lifecycle facts 就會被抹走。

- HTTP → `[err, data, response]` — decoded output + 產生佢嘅 response
- SSE → `[err, stream, open]` — 一條 logical stream + startup response snapshot
- WebSocket → `[err, session, connection]` — logical session + startup connection snapshot

成功時第三個 value 一定存在。HTTP 失敗係 `[error, undefined, undefined]`：fault 已經帶住 response metadata，而傳去 handler、寫 log 或者重新拋出嘅就係嗰個 fault。SSE 同 WebSocket 嘅 startup 失敗，如果已經 capture 到 open 或者 connection snapshot，第三項仍然可以有。

對 SSE 同 WebSocket 嚟講，第三個 value 係 snapshot，唔係保證之後 reconnect 都係同一條 physical connection 嘅 promise。Startup 之後，lifecycle control 屬於 return 出嚟嘅 handle 或者 session。

## Runtime decoding

TypeScript inference 描述你 expect 嘅嘢；佢唔可以喺 runtime check server response。Struct parsing 係 contract 嘅另一半。Defjs 會喺 request construction 之前 validate command input，檢查 representation，再 parse `ok` 適用嗰邊嘅 struct。

解碼**只發生一次，而且係喺 interceptor chain 之後**。Interceptor 用 `makeResponse(...)` 造出嚟嘅 response，同線上真實嚟嘅 response 會被一模一樣地解讀：response 由邊嚟，唔影響佢點被讀，所以唔存在「信 interceptor」呢條要考慮嘅岔路。

次序係：media type，然後 representation，然後 Struct。

| 冇守住嘅係                                | Fault                                          |
| ----------------------------------------- | ---------------------------------------------- |
| Media type 唔係所聲明 representation 要嘅 | `RES_MEDIA_TYPE_INVALID`——讀 body **之前**就報 |
| Bytes 唔係嗰個 representation             | `RES_DECODE_FAILED`                            |
| 值唔符合嗰個 Struct                       | `RES_STRUCT_MISMATCH`                          |
| 非 2xx，而 `error` 解到                   | `HTTP_STATUS`，`data` 有 type                  |
| 非 2xx，而冇聲明 `error`                  | `HTTP_STATUS`，`data: undefined`               |

先查 media type，就係將「我要 JSON，收到 HTML」變成一個精確嘅 fault，而唔係一個 parser error，而且完全跳過讀取、解析同 Struct。

## Builder、encoder 同 alias

Struct 係 field contract，兩個方向都係。`.alias(name)` 係 wire name。Struct 決定一個 value 點 encode。`builder` 決定個 value 去邊。

`builder` 可選、synchronous，而且 pure。佢收到 parsed input——真實 value，唔係 binding view——再 return request：`path`、`query`、`headers` 同 `body`。Command execute 嗰陣先 run。Throw 會變成 tuple 上面嘅 `REQ_BUILD_FAILED`；call endpoint 本身唔會 throw。當 input struct 已經係嗰個 request shape，就 omit `builder`。省略就係 `(input) => input`；input 唔 assignable 嘅時候 TypeScript 會要求有 builder。

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createBatch = defineRequest({
  method: 'POST',
  path: '/accounts/:account_id/users',
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    users: struct.array(
      struct.object({
        displayName: struct.string().alias('display_name'),
        email: struct.string(),
      }),
    ),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { 'x-api-version': '2' },
    body: { users: input.users },
  }),
  output: struct.object({ accepted: struct.number() }),
})

const command = createBatch({
  accountId: 42,
  users: [{ displayName: 'Ada', email: 'ada@example.com' }],
})
void command
```

Default 路徑係交 typed value 過去。`body: { users: input.users }` 會保留每個 user 嘅 alias，所以 wire field 係 `display_name`。你自己寫嘅 key（`account_id`、`x-api-version`）係 literal。Spread 一個 typed object 會保留佢嘅 struct；logical field 旁邊再加 wire key 就係 `REQ_BUILD_FAILED`。

Query nesting 係 backend 嘅性質，所以住喺 client：`withQuerySerializer((query) => string)` 見到嘅係已經 encode 嘅 wire object，包括 aliases。冇 query 嘅時候唔會 call。Builder return 嘅 `URLSearchParams` 會 skip 佢。冇 serializer 嘅時候，arrays 會重複 keys，nested object 會失敗。Interceptors 見到嘅 `queryParams` 係 `new URLSearchParams(queryString)`。

Body kind 由 value 決定，第一個 match 贏：

- 冇 `body` → 咩都唔送
- body root 有 `urlencoded` 或者 `formData` codec → 用嗰種 form encoding；value nest 喺 JSON 入面時個 tag 唔生效
- `FormData`、`URLSearchParams`、`Blob`、`File`、bytes，或者 `ReadableStream` → 原樣送
- string → `text/plain;charset=UTF-8`
- 其他 → JSON

`undefined` fields 會被 omit。Nullable field 嘅 `null` 會送出。String 唔係 JSON，除非你 stringify 佢再 set `content-type`。你自己 serialize（`JSON.stringify`、qs、protobuf）就離開 struct encoder，所以 aliases 唔會套用。冇 public `struct.encode`。

`GET` 同 `HEAD` 唔可以帶 body。WebSocket builders 唔可以 return headers 或者 body。Static WebSocket subprotocols 留喺 definition（`protocols`），唔係 builder。Invalid WebSocket frames 去 session runtime-error listener。SSE `error` struct 會 type 住 startup fault，handshake body 跟 HTTP body 同一套 kind rule：`string` 係 text，blobs 同 files 係 blobs，`arrayBuffer` 係 bytes，其他就係 JSON。

## Observers 同 policy placement

Interceptors 用嚟做 transport-wide policy：auth、tracing、short-circuit、reviewed retry。佢哋淨係為自己嗰個 transport run，同以 onion order compose。Execution options 用嚟做 work-specific lifetime：`signal`、`timeout`、WebSocket heartbeat、opt-in reconnect。

Observers 報告發生咗咩事，但唔會變成第二個 owner。SSE `onInvalidEvent`、WebSocket state listeners，同 runtime-error listeners 用嚟做 bounded diagnostics 同 metrics。Return 出嚟嘅 stream/session 仍然 own iteration、close、unsubscribe 同 terminal waiting。Caching、stale-result suppression、idempotency，同 domain error mapping 應該包喺 `client.execute(...)` 外圍，等你嘅 app 睇到自己嘅 policy 同 state。

## OpenAPI、sourcemaps 同 telemetry

Defjs 唔會 generate 或者 sync 第二份 OpenAPI contract。如果 OpenAPI 已經係 authoritative，就保留佢，再喺 app boundary 加 runtime validation。對新 service，endpoint definitions 同 Structs 可以直接做 wire contract — 唔使第二個 source of truth。

`withOpenTelemetryServer(...)` 會為 client 加 **outbound** Defjs instrumentation。佢唔會 initialize OpenTelemetry SDK。`tracer` 必填，`meter` 可選，三種傳輸預設開，WebSocket query propagation 預設關。Keep operation names static 同 low-cardinality。Propagation、hooks、URLs、headers、payloads、causes 同 retention 都當可能敏感，要 review。

Sourcemaps 係 deployment decision，唔係 Defjs behavior。Public map 帶 `sourcesContent` 會曝光 source；hidden map 仍然有 source 同 paths；disable maps 就冇 source-level symbolication。將 private maps 當 deployable debugging artifacts，配明確 access 同 retention rules。

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [Test with a local Fetch handle](../recipes/test-with-handle.md)
