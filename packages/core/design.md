# `@defjs/core` 使用手册

> 结构合同以 `src/struct/README.md` 和 `src/struct/public_api.ts` 为准。请求放在哪一段由 endpoint 的 `builder` 决定；编码由交出的带类型值驱动。`struct` 只暴露结构声明和 `.alias(name)`，没有公开的 `struct.encode`。

这份文档只保留当前最常用的 API。站点文档在仓库 `doc/`。

## 快速开始

### 创建 client

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))
```

`endpoint` 是基础地址。内部会先用 `new URL(endpoint)` 解析，然后再拼接定义里的 `path`。pathname 当作目录；基础地址上的 query 和 hash 会丢掉。

例如：

```ts
endpoint = 'https://api.example.com/v1'
path = '/user/info'
```

最终请求地址是：

```ts
https://api.example.com/v1/user/info
```

## Client 规则

`client` 是显式创建和传递的执行器：

```ts
const [error, result] = await client.execute(command, options)
```

`defineRequest` / `defineEventStream` / `defineWebSocket` 返回的是 **endpoint**。调用 endpoint 得到一条 command；`client.execute(command, options)` 执行它。没有 `.with({ client })`。

`createGlobalClient` / `getGlobalClient` / `setGlobalClient` / `resetGlobalClient` 已在 0.4 移除。需要多个外部 API 时，分别创建多个 `Client` 实例。

## Struct

endpoint 的 `input`、`output`、`error`、SSE `events`、WebSocket `incoming` / `outgoing` 只接受 `@defjs/core` 的 `struct`。

两条硬规则：

1. 严格失败即停。缺必填字段、类型不对、元组长度不对，都在第一处确定的问题上失败。没有零值填充，也没有部分结果。
2. `output` 或 `error` 省略时，那一侧的 body 根本不读。

`struct.parse(schema, input)` 在 facade 上，返回 error-first 二元组。Struct 实例没有 `.parse()`，也没有 `encode`。没有 `setErrorMap`。

### 构造器

```ts
struct.string()
struct.number()
struct.boolean()
struct.null()
struct.any()
struct.unknown()
struct.bigint()
struct.date()
struct.literal('x')
struct.enum(['a', 'b'])
struct.blob()
struct.file()
struct.arrayBuffer()

struct.array(item)
struct.object({ ... })
struct.record(valueStruct)
struct.tuple([a, b, c])
struct.or(a, b)
struct.intersection(a, b)
struct.discriminatedUnion('type', [optionA, optionB])

struct.urlencoded({ userName: struct.string().alias('username') })
struct.formData({ photo: struct.file() })
```

`urlencoded` 和 `formData` 仍是 object struct，只多一个 codec tag。tag 只在这个值作为 **body 根** 时生效；嵌进别的 JSON 对象后，它就是普通对象字段。没有 `struct.request`、`struct.json`、`struct.text`。

字段链：`.optional()`、`.nullable()`、`.nullish()`、`.alias(name)`。`.alias` 只改外部 wire name，不改 TypeScript 属性名。

递归对象用 getter 字段，边界解析时才读取 getter。

校验 DSL、字符串长度、业务规则放在应用层。未知字段忽略。

## 请求放置

`builder` 是同步纯函数。它收到的是解析后的真实值，返回 `{ path?, query?, headers?, body? }`。它在 command 执行时运行。抛错变成元组上的 `REQ_BUILD_FAILED`，调用 endpoint 本身不抛。

`defineRequest`、`defineEventStream`、`defineWebSocket` 只要声明了 `input`，就必须显式提供 `builder`，即使输入已经是请求形状也一样。只有没有 `input` 的定义可以省略 `builder`。

```ts
import { defineRequest, struct } from '@defjs/core'

const UserBody = struct.object({
  displayName: struct.string().alias('display_name'),
})

const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    id: struct.number(),
    user: UserBody,
  }),
  builder: (input) => ({ path: { id: input.id }, body: input.user }),
  output: UserBody,
})

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: UserBody,
})
```

调用分别是 `updateUser({ id: 7, user: { displayName: 'Ada' } })` 和 `getUser({ id: 7 })`。优先把带类型的值交出去：`body: input.user` 会套用整棵树上的 alias。自己写的对象键是字面 wire key，alias 不生效。展开（spread）保留 struct；逻辑键和 wire 键同时出现是 `REQ_BUILD_FAILED`。

`path` 和 `headers` 必须是扁平标量。`null` 出现在 path、query、headers 里是 `REQ_BUILD_FAILED`。`undefined` 字段省略；`nullable` 的 `null` 会发出去。path 占位符是原始标量，每段只编码一次；空值和 `.` / `..` 拒绝。

### Query

默认编码器接受标量和标量数组（数组重复 key）。嵌套对象在没有 serializer 时是 `REQ_BUILD_FAILED`。

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

`query` 已是编码后的线上对象，alias、`Date` 的 ISO、`bigint` 的字符串都已经应用。返回的字符串原样作为 query string。没有 query 时不调用 serializer。builder 直接返回 `URLSearchParams` 时跳过 serializer，拦截器看到的就是这个实例；否则 `queryParams` 是 `new URLSearchParams(queryString)`。Defjs 不依赖 `qs`。

### Body

按第一个命中的规则：

| `body`                                       | 发出去的内容                                                 | 默认 Content-Type                                            |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 省略 / `undefined`                           | 无 body                                                      | 不新增                                                       |
| 根上带 `urlencoded` 或 `formData` tag 的对象 | `URLSearchParams` / `FormData`，键是 wire name，数组重复字段 | 表单类型 / 平台 boundary；`formData` 清掉已有 `Content-Type` |
| `FormData`、`URLSearchParams`                | 原样                                                         | 同上；`FormData` 会清掉已有 `Content-Type`                   |
| `Blob` / `File`                              | 原样                                                         | `blob.type`，否则 `application/octet-stream`                 |
| `ArrayBuffer`、TypedArray、`DataView`        | 原样                                                         | `application/octet-stream`                                   |
| `ReadableStream`                             | 流式                                                         | `application/octet-stream`                                   |
| `string`                                     | 原文                                                         | `text/plain;charset=UTF-8`                                   |
| 对象、数组、number、boolean、`null`          | 编码后再 `JSON.stringify`                                    | `application/json`                                           |

builder 在 `headers` 里写的 `content-type` 覆盖检测结果，但原生 `FormData` 和根上带 `formData` tag 的对象会清掉已有 `Content-Type`，让 runtime 生成 multipart boundary。字符串是原文；要发 JSON 字符串得自己 `JSON.stringify` 并带上 `application/json`。自己做的 `JSON.stringify`、`qs`、protobuf 离开了 struct 编码，alias 不会套用。

HTTP 拦截器只看到显式类型头，自动类型在最终发送前应用。替换 body 时，显式 `bodyContentType` 优先于 header，显式 header 优先于检测；没有声明时重新检测，`body: undefined` 不新增自动头。`bodyContentType: null` 删除库的类型头，但原生 Fetch 仍可能给 string 补类型。服务端上传进度转流保留显式类型，FormData 使用实际序列化流及其 boundary，不先整体读成 Blob；没有有效显式 `Content-Length` 时总量未知。

`GET` / `HEAD` 不能返回 body，这是类型错误。WebSocket 的 builder 不能返回 `headers` 或 `body`。

## HTTP

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({
    id: struct.number(),
    displayName: struct.string().alias('display_name'),
  }),
  error: struct.object({ message: struct.string() }),
})

const [error, data, response] = await client.execute(getUser({ id: 7 }), { timeout: 10_000 })
```

`output` 是 2xx 的一个 struct；`error` 是其余状态的一个 struct。`ok` 是唯一分叉，只解码一侧。表示法由 kind 决定：`string` 是原文，`blob` / `file` 是 Blob，`arrayBuffer` 是字节，其余是 JSON。没有 `responseType`。

成功是 `[null, data, response]`。失败是 `[error, undefined, undefined]`，元数据在 fault 上。非 2xx 且 `error` 解码成功是 `HTTP_STATUS`；媒体类型不符是 `RES_MEDIA_TYPE_INVALID`（读 body 之前）；表示法读不出是 `RES_DECODE_FAILED`；struct 不匹配是 `RES_STRUCT_MISMATCH`。传输失败是 fault，不是 status 0 的响应。

执行选项里的 `abort` 和 `timeout` 互斥，都可以再配 `signal`。非法 timeout、两者同时出现，是 `REQ_OPTIONS_INVALID`。input 通不过 struct 是 `REQ_INPUT_INVALID`。

## SSE

```ts
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const watchUser = defineEventStream({
  method: 'GET',
  path: '/users/:id/events',
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  error: struct.object({ message: struct.string() }),
  events: {
    message: struct.object({ text: struct.string() }),
  },
})

const [error, stream, open] = await client.execute(watchUser({ id: 7 }))
```

请求放置与 HTTP 相同，包含 body。事件 `data` 按 kind 解码：`string` 保持原文，其余先 `JSON.parse` 再交给 struct。裸字面量不是 JSON 文本。声明了 `error` 时，启动失败是 `Fault<TError>`；握手错误 body 同样按 kind。非 2xx 且该侧未声明或解码成功是 `HTTP_STATUS`；JSON 媒体类型不符是 `RES_MEDIA_TYPE_INVALID`；声明的握手 body 读取、解析或 Struct 校验失败是 `RES_DECODE_FAILED`，Struct 失败的 `cause` 是 `StructError`，不是 HTTP 的 `RES_STRUCT_MISMATCH`。未声明或校验失败的事件不进队列；`withSSEOnInvalidEvent` 可以观察。重连要显式 `withSSEReconnect`。

## WebSocket

`incoming` 和 `outgoing` 各是一个 struct。多种消息用 `struct.discriminatedUnion`。没有消息 map，没有 type 信封，没有 `normalizeIncoming` / `normalizeOutgoing`。

```ts
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  path: '/chat/:roomId',
  maxIncomingQueueSize: 100,
  protocols: ['chat.v1'],
  input: struct.object({ roomId: struct.string() }),
  builder: (input) => ({ path: input }),
  incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
  outgoing: struct.object({ type: struct.literal('send'), text: struct.string() }),
})

const [error, session] = await client.execute(room({ roomId: '1' }))
```

入站文本、`ArrayBuffer`、TypedArray、`Blob` 按 UTF-8 读取，再 `JSON.parse`，再交给 `incoming`。坏 JSON 和 struct 失败进 `session.onRuntimeError`，该帧不入队，会话继续。不是文本、字节或 Blob 的帧直接丢掉，不通知。没有 `withWebSocketOnInvalidEvent`。

`session.send` 同步校验并序列化：struct 编码，然后 `JSON.stringify`。query 规则与 HTTP 相同，不再把复杂 query 单独 JSON 化。静态 `protocols` 写在定义上；`execute` 选项和 `withWebSocketProtocols` 仍可覆盖，优先级是执行选项、client、定义。选中的列表在逻辑会话开始前复制，并在重连时复用；builder、`beforeConnect` 和 interceptor 都不能改子协议。需要 token-in-subprotocol 时，先获取 token，再通过该次 `execute` 的 `protocols` 选项传入。

## interceptor

鉴权、trace、跨请求改 header 放在 interceptor。`builder` 只放置当前 input。低基数身份用定义上的 `operation`。拦截器看到的 `queryParams` 是 `new URLSearchParams(queryString)`；builder 交出的 `URLSearchParams` 则是同一实例。

## 当前不提供

1. `struct.empty()`
2. `executeRaw(...)`
3. 全局 client
4. `responseType`、`struct.request`、`struct.json`、`struct.text`
5. WebSocket 自定义握手 headers
6. OpenAPI 生成
