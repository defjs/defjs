---
title: HTTP
description: 定义请求，execute，按状态分支，用 signal 或 timeout 取消。
---

# HTTP

定义 → execute → 看 tuple 分支 → 页面走了就取消。HTTP 环就这些。

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

const [error, data, response] = await client.execute(getUser({ id: 7 }))
if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (!error) {
  console.log(data.name, response.status)
}
```

## 解析 URL

`withEndpoint(...)` 要合法绝对 URL。Endpoint pathname 当目录留下；query 和 hash 在 command 解析前丢掉。

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

Path 占位符是原始标量，恰好编码一次。空值和 `.` / `..` 会被拒。一个占位符里的斜杠、`?`、`#`、`%`、空格、Unicode 仍是一段编码后的 path——别预先编码。

Definition path 不能含 `?` 或 `#`，也不能是绝对或协议相对。默认 query 编码器接受标量和标量数组（数组重复 key）。嵌套对象会 `REQ_BUILD_FAILED`，除非 client 有 `withQuerySerializer(...)`。`path`、`query`、`headers` 里的 `null` 同样失败。`undefined` 省略。

## 摆放 input

Struct 编码值。`builder` 把它放上去。只要声明了 `input`，就必须显式提供 `builder`，即使输入已经是请求形状也一样。只有没有 `input` 的定义可以省略 `builder`。

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
  builder: (input) => ({
    path: input.path,
    headers: input.headers,
    body: input.body,
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

这个 body 是 `{"display_name":"Ada"}`，`application/json`。Header 的线上名字是 `x-request-id`。调用方和 parse 结果仍用 `displayName`。

优先把带类型的值交过去，别手写线上 key。Alias 在字段上声明一次，两个方向都生效：`output` / `error` / 事件 / incoming frame 把 `display_name` 解成 `displayName`，`body: input.order` 会改写整棵树。同一个 `User` struct 可以既是创建 body，也是 GET 的 output。手写 key 是例外：外层对象是匿名的，alias 不跑。

| Builder 表达式                                  | 线上                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| `body: input.profile`                           | 带类型的对象：alias，以及 `Date` / `bigint` 编码 |
| `body: { profile: input.profile }`              | 外层 key 是字面量，内层对象仍带类型              |
| `body: { ...input.profile, role: 'admin' }`     | 展开保住 struct；多出来的 key 是字面量           |
| `body: { name: input.profile.displayName }`     | 匿名父对象：alias 不生效                         |
| `query: input.query` / `headers: input.headers` | 带类型的扁平对象：alias 变成线上 key             |

展开带类型的对象，同时又写下它的线上 key（`display_name` 挨着 `displayName`）就是 `REQ_BUILD_FAILED`。`path` 或 `headers` 里的嵌套对象同样失败。

引导按每个节点决定，不只在根上。匿名父对象下面新写的对象保留你写下的 key。带类型的父对象下面，同一个对象改用该字段的 struct。

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union 引导同时命中多个分支时，每个分支都编码再比较。线上结果一致就采用；有差异就是 `REQ_BUILD_FAILED`。

混合 intersection（包含非 object 部分）解析时，标签是各匹配部分已有标签的合取；未经解析、新写的混合 intersection 值按匿名对象处理。

### Query

嵌套 query 形状（`a[b]`、`a.b`、逗号列表）是后端约定，所以钩子在 client 上：

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

这里的 `query` 是已经编码的线上对象。Alias 已经应用，所以像 `qs` 这样的 serializer 不会丢掉它们。返回的 string 就是 query string。Defjs 不依赖 `qs`。

没有 serializer 时，数组重复 key，嵌套对象是 `REQ_BUILD_FAILED`。builder 返回 `URLSearchParams` 时原样使用，并跳过 serializer。没有 query 时不会调用 serializer。之后 interceptor 看到的 `queryParams` 是 `new URLSearchParams(queryString)`。

### Body

先匹配的赢：

| `body` 值                                            | 发出去的是                                                 | 默认 content type                                     |
| ---------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| 省略 / `undefined`                                   | 没有 body                                                  | —                                                     |
| 根上带 `urlencoded` 或 `formData` codec 的带类型对象 | `URLSearchParams` / `FormData`；key 是线上名；数组重复 key | 表单类型 / 平台 boundary                              |
| `FormData`、`URLSearchParams`                        | 原样                                                       | 原样；Defjs 会清掉 `FormData` 上过期的 `Content-Type` |
| `Blob` / `File`                                      | 原样                                                       | `blob.type`，或 `application/octet-stream`            |
| `ArrayBuffer`、`TypedArray`、`DataView`              | 原样                                                       | `application/octet-stream`                            |
| `ReadableStream`                                     | 流式（运行时允许时 `duplex: 'half'`）                      | `application/octet-stream`                            |
| `string`                                             | 原样                                                       | `text/plain;charset=UTF-8`                            |
| object、array、number、boolean、`null`               | 编码后再 `JSON.stringify`                                  | `application/json`                                    |

在 `headers` 上设 `content-type` 可以覆盖默认。codec tag 只在 body 根生效：`body: { meta: input.form }` 是 JSON，表单字段是普通 JSON 字段。string 是原始文本；`"abc"` 这种 JSON 字符串需要 `JSON.stringify` 加上 `application/json`。`undefined` 字段省略；`nullable` 字段发出 `null` 就是 JSON `null`。

`GET` 和 `HEAD` 不能返回 body——这是类型错误。WebSocket builder 不能返回 `headers` 或 `body`。

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

你自己跑的 `JSON.stringify`、`qs` 或 protobuf 看到的是逻辑名。那条路上 alias 不生效。没有公开的 `struct.encode`。

builder 可以按真实 input 分支，每种情况返回不同 body（JSON 记录、`File`，或 `URLSearchParams`）。原生 `Headers` 也会原样传过去，不会重新编码。

## body 怎么读

`output` 是 2xx body 的单一 Struct；`error` 是其余一切的单一 Struct。struct kind 选出表示：`string` 是原始文本，`blob` / `file` 是 blob，`arrayBuffer` 是字节，其余 kind 是 JSON。两边都没声明时，body 根本不会被读。

顺序：

1. `ok` 挑边：2xx 走 `output`，其余走 `error`。永不两者都走。
2. 那一侧没声明 → body 根本不会被读。2xx 成功且 `data === undefined`；非 2xx 是 `HTTP_STATUS` 且 `data === undefined`。你没声明的那一侧 body 读不出来会被整个忽略，连「它读不出来」这件事也忽略。
3. 媒体类型在读 body **之前**就检查。不匹配就是 `RES_MEDIA_TYPE_INVALID`，不解析也不解码。
4. 读取表示。失败是 `RES_DECODE_FAILED`。传输来的 JSON 只解析一次：该值上的字符串是 JSON 字符串根，不会再次解析；字节和 blob 仍是原始数据，只解析一次。
5. Struct 解析值。失败是 `RES_STRUCT_MISMATCH`。
6. 2xx → 结果加一个带类型的 `response.body`；非 2xx → `HTTP_STATUS` 上带类型的 `data`。

解码只发生一次，且在拦截器链之后，所以拦截器用 `makeResponse(...)` 造的响应，和线上来的读法完全一样。对于 JSON 表示，字符串 body 是 JSON 字符串根。

成功的响应是 `DecodedResponse<T>`：`url`、`status`、`statusText`、`headers`、`ok`，外加一个带类型的 `body`。什么都没解码时你拿到 `HttpMeta`——同样的字段，只是没有 `body`。`ok` 只表示 `200 <= status < 300`。两者都不是原生 `Response`。传输失败是 fault，所以不存在代表它的 status-0 响应。

## 取消工作 {#cancel-the-work}

执行 options 收 `signal`，再配 `abort` 或 `timeout` 其一。**`abort` 和 `timeout` 互斥。** `signal` 可以跟其中任一个搭配。

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

`timeout` 必须是 `1..2_147_483_647` 的正 safe integer。识别出的取消 → `NET_ABORTED`；执行超时 → `NET_TIMEOUT`；interceptor `throw` → `EXT_INTERCEPTOR_FAILED`；其他 Fetch 失败 → `NET_UNREACHABLE`。服务端已接受写入后的取消，**不能**证明写入回滚了。

## Credentials 与 XSRF

`withCredentials(true)` 给 HTTP 和 SSE 设 Fetch `credentials: 'include'`。它不创建 `Authorization`，也不配置 WebSocket 鉴权。`false` 则不指定 credentials。

`withXSRF(...)` 只作用于 HTTP。默认：`cookieName: 'XSRF-TOKEN'`，`headerName: 'X-XSRF-TOKEN'`。Header 只在非安全方法、调用方还没设、且是同源浏览器请求时注入。跳过 `GET`、`HEAD`、`OPTIONS`、`TRACE`。浏览器外若要注入，传同步的请求作用域 `tokenProvider`。

日常日志里别带 credentials、XSRF token、query 字符串。别把 query 当通用凭证通道。

## Progress 与 Fetch 边界

`onDownloadProgress` 在声明过的响应 body 被读取时跑。只有正的 `Content-Length` 时 `lengthComputable` 才为 true。那一侧没有 struct → body 不会被读 → 也没有 body 读取进度。

`onUploadProgress` 盯着 Fetch 读取的 `ReadableStream<Uint8Array>` 请求 body。JSON 或文本 body 不是那种流——要上传进度时，从 builder 返回 `file.stream()`（或另一条 `ReadableStream`）。运行时发不了流式 body 时，传输会报能力错误。

`fetchHandler(httpRequest, fetchImpl?)` 是更底层的 Fetch 边界：拼原生 `Request`、调 Fetch、读表示、返回 `HttpResponse`。它**不**校验 command 输入、不按 `output` 分派、不跑 interceptor。适合注入传输测试——不能替代 `client.execute`。

## 重放限制

Defjs **不会**自动重试 HTTP。重试读仍要有审过的超时/网络/重复政策。重试 mutation 需要可重放字节、服务端支持、绑定鉴权作用域 + 请求字节的幂等 key，以及接收方去重政策。

Client/command/Fetch 边界没法知道失败写入是否已提交。重放决策放在应用或审过的 interceptor。Interceptor 可以短路或替换底层请求；最终状态和 body 仍须满足 command 契约。

## 相关配方

- [声明了 404 的 GET](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [取消一次 HTTP](../recipes/cancel-http.md)
- [用本地 Fetch handle 做测试](../recipes/test-with-handle.md)
