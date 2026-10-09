---
title: HTTP
description: Define 一個 request，execute 佢，按 status 分支，再用 signal 或者 timeout cancel。
---

# HTTP

Define → execute → 按 tuple 分支 → screen 離開就 cancel。呢個就係成個 HTTP loop。

## Basic Setup

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

const [error, data, response] = await client.execute(getUser({ id: 7 }))
if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (!error) {
  console.log(data.name, response.status)
}
```

## 解出 URL

`withEndpoint(...)` 要有效嘅 absolute URL。Endpoint pathname 當 directory 留住；query 同 hash 會喺 command resolution 之前丟棄。

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({ path: { id: input.id }, query: { fields: input.fields } }),
})

const command = getUser({ id: 'a/b', fields: 'name' })
void client.execute(command)
// → https://api.example.com/v1/users/a%2Fb?fields=name
```

Path placeholders 係 raw scalars，encode 剛好一次。Empty values 同 `.` / `..` 會被 reject。一個 placeholder 入面嘅 slashes、`?`、`#`、`%`、spaces 同 Unicode 仍然係一個 encoded segment — 唔好 pre-encode。

Definition path 唔可以有 `?` 或者 `#`，亦唔可以係 absolute 或者 protocol-relative。Default query encoder 接受 scalars 同 arrays of scalars（arrays 會重複 key）。Nested object 會 fail 做 `REQ_BUILD_FAILED`，除非 client 有 `withQuerySerializer(...)`。`path`、`query` 或者 `headers` 入面嘅 `null` 都係同一種失敗。`undefined` 會被 omit。

## 擺放 input

Struct encode 個 value。Builder 擺放佢。當 `input` 已經係 `{ path?, query?, headers?, body? }`，就 omit `builder`。

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})

const [error, user] = await client.execute(
  updateUser({
    path: { id: 7 },
    headers: { requestId: 'request-42' },
    body: { displayName: 'Ada' },
  }),
)
if (error) console.error(error.code)
else console.log(user.id)
```

嗰個 body 係 `{"display_name":"Ada"}`，content type 係 `application/json`。Header 嘅 wire name 係 `x-request-id`。Callers 同 parsed results 保留 `displayName`。

Prefer 交 typed value，唔好自己拼 wire keys。Alias 喺 field 上面 declare 一次，兩個方向都生效：`output` / `error` / events / incoming frames 會將 `display_name` decode 成 `displayName`，而 `body: input.order` 會 rewrite 成棵 tree。同一個 `User` struct 可以係 create body，亦可以係 get output。手寫 key 係例外：parent object 係 anonymous，所以 alias 唔會 run。

| Builder expression                              | 線上點樣                                          |
| ----------------------------------------------- | ------------------------------------------------- |
| `body: input.profile`                           | Typed object：alias 同 `Date` / `bigint` encoding |
| `body: { profile: input.profile }`              | 外層 keys 係 literal，內層 object 仍然 typed      |
| `body: { ...input.profile, role: 'admin' }`     | Spread 保留 struct；額外嗰個 key 係 literal       |
| `body: { name: input.profile.displayName }`     | Anonymous parent：alias 唔會套用                  |
| `query: input.query` / `headers: input.headers` | Typed flat objects：alias 變成 wire key           |

Spread 一個 typed object 同時又 set 佢嘅 wire key（`display_name` 同 `displayName` 一齊）就係 `REQ_BUILD_FAILED`。`path` 或者 `headers` 入面嘅 nested object 都係同一種失敗。

引導喺每個節點決定，唔只喺 root。Anonymous parent 下面新寫嘅 object 保留你寫落嘅 key。Typed parent 下面，同一個 object 改用嗰個 field 嘅 struct。

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union 引導同時 match 多過一個 branch 嘅時候，每個 branch 都 encode 再比較。Wire 結果一樣就採用；有分別就係 `REQ_BUILD_FAILED`。

混合 intersection（包含非 object 部分）解析嗰陣，標籤係各匹配部分已有標籤嘅合取；未經解析、新寫嘅混合 intersection 值就當匿名 object 處理。

### Query

Nested query shape（`a[b]`、`a.b`、comma lists）係 backend convention，所以個 hook 住喺 client：

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

呢度嘅 `query` 係已經 encode 嘅 wire object。Aliases 已經套用，所以 `qs` 呢類 serializer 唔會掉佢哋。Return 嘅 string 就係 query string。Defjs 唔 depend on `qs`。

冇 serializer 嘅時候，arrays 會重複 keys，nested object 就係 `REQ_BUILD_FAILED`。Builder return `URLSearchParams` 就原樣用嗰個 value，並 skip serializer。冇 query 嘅時候唔會 call serializer。之後 interceptors 見到嘅 `queryParams` 係 `new URLSearchParams(queryString)`。

### Body

第一個 match 贏：

| `body` value                                             | 送出點樣                                                            | Default content type                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| omitted / `undefined`                                    | 冇 body                                                             | —                                                        |
| root 有 `urlencoded` 或 `formData` codec 嘅 typed object | `URLSearchParams` / `FormData`；keys 係 wire names；arrays 重複 key | form type / platform boundary                            |
| `FormData`、`URLSearchParams`                            | 原樣                                                                | 一樣；Defjs 會清 `FormData` 上面 stale 嘅 `Content-Type` |
| `Blob` / `File`                                          | 原樣                                                                | `blob.type`，或者 `application/octet-stream`             |
| `ArrayBuffer`、`TypedArray`、`DataView`                  | 原樣                                                                | `application/octet-stream`                               |
| `ReadableStream`                                         | streamed（runtime 允許時用 `duplex: 'half'`）                       | `application/octet-stream`                               |
| `string`                                                 | 原樣                                                                | `text/plain;charset=UTF-8`                               |
| object、array、number、boolean、`null`                   | encode 完再 `JSON.stringify`                                        | `application/json`                                       |

喺 `headers` set `content-type` 就可以 override default。Codec tag 只喺 body root 生效：`body: { meta: input.form }` 係 JSON，form fields 就係普通 JSON fields。String 係 raw text；`"abc"` 呢類 JSON string 要 `JSON.stringify` 再加 `application/json`。`undefined` fields 會被 omit；`nullable` field 送 `null` 就係 JSON `null`。

`GET` 同 `HEAD` 唔可以 return body——呢個係 type error。WebSocket builders 唔可以 return `headers` 或者 `body`。

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const login = defineRequest({
  method: 'POST',
  path: '/login',
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias('username'),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
})

const upload = defineRequest({
  method: 'POST',
  path: '/files/:id',
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData()
    input.photos.forEach((photo, index) => body.append('photo', photo, `photo-${index}.jpg`))
    return { path: { id: input.id }, body }
  },
})

void login
void upload
```

你自己 run 嘅 `JSON.stringify`、`qs` 或者 protobuf 見到嘅係 logical names。嗰條路 alias 唔會套用。冇 public `struct.encode`。

Builder 可以按真實 input 分支，每個 case return 唔同 body（JSON records、一個 `File`，或者 `URLSearchParams`）。Native `Headers` 亦會 pass through，唔會再 encode。

## body 點讀

`output` 係 2xx body 嘅單一 Struct；`error` 係其餘一切嘅單一 Struct。Struct kind 揀 representation：`string` 係 raw text，`blob` / `file` 係 blobs，`arrayBuffer` 係 bytes，其他 kind 都係 JSON。兩邊都冇聲明，body 就根本唔會被讀。

次序：

1. `ok` 揀邊：2xx 走 `output`，其餘走 `error`。絕對唔會兩邊都走。
2. 嗰一邊冇聲明 → body 根本唔會被讀。2xx 成功而 `data === undefined`；非 2xx 係 `HTTP_STATUS` 而 `data === undefined`。你冇聲明嗰一邊嘅 body 解唔出會被完全忽略，連「佢解唔出」呢件事都忽略。
3. Media type 喺讀 body **之前**就查。唔對就係 `RES_MEDIA_TYPE_INVALID`，唔會 parse 亦唔會解碼。
4. 讀 representation。失敗係 `RES_DECODE_FAILED`。Transport 嚟嘅 JSON 只 parse 一次：呢個值上面嘅字串係 JSON 字串根，唔會再 parse；bytes 同 blob 仍然係原始資料，只會 parse 一次。
5. Struct 解析個值。失敗係 `RES_STRUCT_MISMATCH`。
6. 2xx → 結果加一個有 type 嘅 `response.body`；非 2xx → `HTTP_STATUS` 上面有 type 嘅 `data`。

解碼只發生一次，而且喺 interceptor chain 之後，所以 interceptor 用 `makeResponse(...)` 造嘅 response，同線上嚟嘅讀法一模一樣。對於 JSON 表示，字串 body 係 JSON 字串根。

成功嘅 response 係 `DecodedResponse<T>`：`url`、`status`、`statusText`、`headers`、`ok`，再加一個有 type 嘅 `body`。冇解碼到任何嘢嘅時候你拿到 `HttpMeta`——一樣嘅 fields，只係冇 `body`。`ok` 只表示 `200 <= status < 300`。兩者都唔係原生 `Response`。Transport failure 係 fault，所以唔存在代表佢嘅 status-0 response。

## Cancel the work {#cancel-the-work}

Execution options 收 `signal`，再加 `abort` 或者 `timeout`。**`abort` 同 `timeout` 互斥。** `signal` 可以同其中一個一齊用。

```ts
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const command = defineRequest({ method: 'GET', path: '/report' })()
const controller = new AbortController()
const pending = client.execute(command, { signal: controller.signal, timeout: 5_000 })

controller.abort('screen closed')
const [error] = await pending
if (error?.code === 'NET_ABORTED') {
  console.log('caller cancellation')
}
```

`timeout` 一定要係 `1..2_147_483_647` 入面嘅 positive safe integer。Recognized cancel → `NET_ABORTED`；execution timeout → `NET_TIMEOUT`；interceptor `throw` → `EXT_INTERCEPTOR_FAILED`；其他 Fetch failures → `NET_UNREACHABLE`。Server 接受咗 write 之後再 cancel，**唔**證明 write 已經 rollback。

## Credentials 同 XSRF

`withCredentials(true)` 為 HTTP 同 SSE set Fetch `credentials: 'include'`。佢唔會 create `Authorization`，亦唔會 configure WebSocket auth。`false` 會留 credentials unspecified。

`withXSRF(...)` 淨係 HTTP。Defaults：`cookieName: 'XSRF-TOKEN'`，`headerName: 'X-XSRF-TOKEN'`。Header 淨係為 non-safe methods inject，而且只喺 caller 未 set、同埋 same-origin browser requests 時。Skip `GET`、`HEAD`、`OPTIONS`、`TRACE`。喺 browser 之外，如果需要 injection，就傳 synchronous request-scoped `tokenProvider`。

Keep credentials、XSRF tokens 同 query strings 出日常 logs。唔好用 query params 當一般 credential channel。

## Progress 同 Fetch boundary

`onDownloadProgress` 會喺讀已聲明嘅 response body 時 run。`lengthComputable` 淨係喺有 positive `Content-Length` 時先係 true。嗰一邊冇 struct → body 唔會被讀 → 冇 body-read progress。

`onUploadProgress` 睇住 Fetch 讀 `ReadableStream<Uint8Array>` request body。JSON 或者 text body 唔係嗰條 stream——需要 upload progress 就喺 builder return `file.stream()`（或者其他 `ReadableStream`）。Runtime 送唔到 streamed body 嘅時候，transport 會報 capability error。

`fetchHandler(httpRequest, fetchImpl?)` 係更低層嘅 Fetch boundary：build native `Request`，call Fetch，讀 representation，return `HttpResponse`。佢 **唔會** validate command input、dispatch `output`，或者 run interceptors。對 injected transport tests 有用 — 唔係 `client.execute` 嘅替代品。

## Replay limits

Defjs **唔會** auto-retry HTTP。Retry 一次 read 仍然要有 reviewed timeout/network/duplicate policy。Retry 一次 mutation 要 replayable bytes、server support、綁住 auth scope + request bytes 嘅 idempotency key，同 receiver duplicate policy。

Client/command/Fetch boundary 唔知 failed write 有冇 commit。將 replay decisions 留喺 app 或者 reviewed interceptor。Interceptors 可以 short-circuit 或者 replace low-level request；最終 status 同 body 仍然要滿足 command 嘅 contract。

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
- [Test with a local Fetch handle](../recipes/test-with-handle.md)
