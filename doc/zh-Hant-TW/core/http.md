---
title: HTTP
description: 定義請求、執行、依 status 分支，並用 signal 或 timeout 取消。
---

# HTTP

定義 → 執行 → 依 tuple 分支 → 畫面離開就取消。HTTP 迴圈就這樣。

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

## 解析 URL

`withEndpoint(...)` 需要有效的絕對 URL。Endpoint pathname 當目錄保留；query 與 hash 在 command 解析前會丟掉。

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

Path placeholders 是原始 scalars，只 encode 一次。空值與 `.`／`..` 會被拒絕。單一 placeholder 裡的斜線、`?`、`#`、`%`、空白、Unicode 會留在同一個 encoded segment — 別先 encode。

Definition path 不能含 `?` 或 `#`，也不能是絕對或 protocol-relative。預設 query encoder 接受 scalars 與 scalars 陣列（陣列會重複 key）。沒有 `withQuerySerializer(...)` 時，巢狀物件會以 `REQ_BUILD_FAILED` 失敗。`path`、`query` 或 `headers` 裡的 `null` 同樣會失敗。`undefined` 會省略。

## 放置 input

Struct 負責編碼值。Builder 負責放置它。當 `input` 已經是 `{ path?, query?, headers?, body? }` 時，省略 `builder`。

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

那個 body 是 `{"display_name":"Ada"}`，content type 是 `application/json`。Header 的 wire 名稱是 `x-request-id`。呼叫端與剖析結果仍用 `displayName`。

優先把型別化的值交出去，而不是自己拼 wire keys。Alias 在欄位上宣告一次，雙向都適用：`output`／`error`／events／incoming frames 把 `display_name` 解成 `displayName`，而 `body: input.order` 會改寫整棵樹。同一個 `User` struct 可以當建立用的 body，也可以當取得用的 output。自己寫的 key 是例外：父物件是匿名的，所以 alias 不會跑。

| Builder 運算式                                 | 線上                                            |
| ---------------------------------------------- | ----------------------------------------------- |
| `body: input.profile`                          | 型別化物件：套用 alias 與 `Date`／`bigint` 編碼 |
| `body: { profile: input.profile }`             | 外層 keys 是字面；內層物件仍有型別              |
| `body: { ...input.profile, role: 'admin' }`    | 展開保留 struct；多出來的 key 是字面            |
| `body: { name: input.profile.displayName }`    | 匿名父物件：alias 不套用                        |
| `query: input.query`／`headers: input.headers` | 型別化的扁平物件：alias 變成 wire key           |

在型別化物件上展開，又同時設定它的 wire key（`display_name` 跟 `displayName` 並排）是 `REQ_BUILD_FAILED`。`path` 或 `headers` 裡的巢狀物件同樣會失敗。

引導在每個節點決定，不只在根上。匿名父物件底下新寫的物件保留你寫下的 key。帶型別的父物件底下，同一個物件改用該欄位的 struct。

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union 引導同時命中多個分支時，每個分支都編碼再比較。線上結果一致就採用；有差異就是 `REQ_BUILD_FAILED`。

混合 intersection（包含非 object 部分）解析時，標籤是各匹配部分既有標籤的合取；未經解析、新寫的混合 intersection 值按匿名物件處理。

### Query

巢狀 query 形狀（`a[b]`、`a.b`、逗號清單）是後端慣例，所以 hook 在 client 上：

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

這裡的 `query` 是已編碼的 wire 物件。Aliases 已經套用，所以像 `qs` 這種 serializer 不會丟掉它們。回傳的字串就是 query string。Defjs 不依賴 `qs`。

沒有 serializer 時，陣列會重複 key，巢狀物件是 `REQ_BUILD_FAILED`。Builder 回傳 `URLSearchParams` 時會原樣使用並跳過 serializer。沒有 query 時不會呼叫 serializer。之後 interceptors 看到的 `queryParams` 是 `new URLSearchParams(queryString)`。

### Body

第一個相符者勝出：

| `body` 值                                            | 送出形式                                                       | 預設 content type                                     |
| ---------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| 省略／`undefined`                                    | 沒有 body                                                      | —                                                     |
| 根上帶 `urlencoded` 或 `formData` codec 的型別化物件 | `URLSearchParams`／`FormData`；keys 是 wire 名稱；陣列重複 key | form 類型／平台 boundary                              |
| `FormData`、`URLSearchParams`                        | 原樣                                                           | 同上；Defjs 會清掉 `FormData` 上過期的 `Content-Type` |
| `Blob`／`File`                                       | 原樣                                                           | `blob.type`，或 `application/octet-stream`            |
| `ArrayBuffer`、`TypedArray`、`DataView`              | 原樣                                                           | `application/octet-stream`                            |
| `ReadableStream`                                     | 串流（runtime 允許時 `duplex: 'half'`）                        | `application/octet-stream`                            |
| `string`                                             | 原樣                                                           | `text/plain;charset=UTF-8`                            |
| object、array、number、boolean、`null`               | 編碼後再 `JSON.stringify`                                      | `application/json`                                    |

在 `headers` 上設 `content-type` 可覆寫預設。Codec tag 只在 body 根上生效：`body: { meta: input.form }` 是 JSON，form 欄位是普通 JSON 欄位。字串是原始文字；像 `"abc"` 這種 JSON 字串需要 `JSON.stringify` 再加上 `application/json`。`undefined` 欄位會省略；`nullable` 欄位送出 `null` 時是 JSON `null`。

`GET` 與 `HEAD` 不能回傳 body — 那是型別錯誤。WebSocket builder 不能回傳 `headers` 或 `body`。

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

你自己跑的 `JSON.stringify`、`qs` 或 protobuf 看到的是邏輯名稱。那條路上 alias 不套用。沒有公開的 `struct.encode`。

Builder 可以依真實 input 分支，每個情況回傳不同 body（JSON records、`File`，或 `URLSearchParams`）。原生 `Headers` 也會原樣傳下去，不會重新編碼。

## body 怎麼讀

`output` 是 2xx body 的單一 Struct；`error` 是其餘一切的單一 Struct。Struct kind 決定表示：`string` 是原始文字，`blob`／`file` 是 blobs，`arrayBuffer` 是 bytes，其餘 kind 都是 JSON。兩邊都沒宣告時，body 根本不會被讀。

順序：

1. `ok` 挑邊：2xx 走 `output`，其餘走 `error`。絕不兩邊都走。
2. 那一側沒宣告 → body 根本不會被讀。2xx 成功且 `data === undefined`；非 2xx 是 `HTTP_STATUS` 且 `data === undefined`。你沒宣告的那一側 body 解不出來會被整個忽略，連「它解不出來」這件事也忽略。
3. 媒體類型在讀 body **之前**就檢查。不匹配就是 `RES_MEDIA_TYPE_INVALID`，不解析也不解碼。
4. 讀取表示。失敗是 `RES_DECODE_FAILED`。傳輸來的 JSON 只解析一次：該值上的字串是 JSON 字串根，不會再次解析；位元組和 blob 仍是原始資料，只解析一次。
5. Struct 解析值。失敗是 `RES_STRUCT_MISMATCH`。
6. 2xx → 結果加一個有型別的 `response.body`；非 2xx → `HTTP_STATUS` 上有型別的 `data`。

解碼只發生一次，而且在 interceptor 鏈之後，所以 interceptor 用 `makeResponse(...)` 造的回應，和線上來的讀法完全一樣。對於 JSON 表示，字串 body 是 JSON 字串根。

成功的回應是 `DecodedResponse<T>`：`url`、`status`、`statusText`、`headers`、`ok`，外加一個有型別的 `body`。什麼都沒解碼時你拿到 `HttpMeta`——同樣的欄位，只是沒有 `body`。`ok` 只表示 `200 <= status < 300`。兩者都不是原生 `Response`。傳輸失敗是 fault，所以不存在代表它的 status-0 回應。

## 取消工作 {#cancel-the-work}

執行 options 接受 `signal`，再加上 `abort` 或 `timeout`。**`abort` 與 `timeout` 互斥。** `signal` 可以跟其中一個搭配。

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

`timeout` 必須是 `1..2_147_483_647` 的正 safe integer。認得的取消 → `NET_ABORTED`；執行逾時 → `NET_TIMEOUT`；interceptor `throw` → `EXT_INTERCEPTOR_FAILED`；其他 Fetch 失敗 → `NET_UNREACHABLE`。伺服器已接受寫入後再取消，**不能**證明寫入已回滾。

## Credentials 與 XSRF

`withCredentials(true)` 為 HTTP 與 SSE 設 Fetch `credentials: 'include'`。它不會建立 `Authorization`，也不會設定 WebSocket auth。`false` 則不指定 credentials。

`withXSRF(...)` 只給 HTTP。預設：`cookieName: 'XSRF-TOKEN'`、`headerName: 'X-XSRF-TOKEN'`。Header 只在非安全方法、呼叫端尚未設定、且是同源瀏覽器請求時注入。會跳過 `GET`、`HEAD`、`OPTIONS`、`TRACE`。非瀏覽器環境若要注入，請傳同步、請求範圍的 `tokenProvider`。

Credentials、XSRF tokens、query strings 別進日常 logs。別把 query params 當一般憑證通道。

## Progress 與 Fetch 邊界

`onDownloadProgress` 在讀已宣告的回應 body 時跑。只有正的 `Content-Length` 時 `lengthComputable` 才是 true。那一側沒有 struct → body 不會被讀 → 沒有 body-read progress。

`onUploadProgress` 在 Fetch 讀 `ReadableStream<Uint8Array>` 請求 body 時觀察。JSON 或文字 body 不是那種串流 — 需要 upload progress 時，從 builder 回傳 `file.stream()`（或其他 `ReadableStream`）。Runtime 送不出串流 body 時，傳輸會回報 capability error。

`fetchHandler(httpRequest, fetchImpl?)` 是較低階的 Fetch 邊界：建立原生 `Request`、呼叫 Fetch、讀 representation、回傳 `HttpResponse`。它**不會**驗證 command input、分派 `output`，或跑 interceptors。適合注入傳輸測試 — 不能取代 `client.execute`。

## 重放限制

Defjs **不會**自動重試 HTTP。重試讀取仍需要審過的逾時／網路／重複政策。重試 mutation 需要可重放的 bytes、伺服器支援、綁定 auth 範圍 + request bytes 的 idempotency key，以及接收端的重複政策。

Client／command／Fetch 邊界無法知道失敗的寫入有沒有提交。把重放決策放在應用程式或審過的 interceptor。Interceptors 可以 short-circuit 或替換低階 request；最終 status 與 body 仍須滿足 command 契約。

## 相關 recipes

- [已宣告 404 的 GET](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [取消 HTTP 呼叫](../recipes/cancel-http.md)
- [用本機 Fetch handle 測試](../recipes/test-with-handle.md)
