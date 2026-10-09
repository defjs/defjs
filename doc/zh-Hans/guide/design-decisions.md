---
title: 设计决策
description: 为什么 Defjs 把契约、command、传输结果、解码和所有权都摊开。
---

# 设计决策

Defjs 做了几处有意的取舍。方便型 API 常常把「谁拥有请求、流、会话」藏起来。Defjs 把这条边界留在明处，这样你可以复用同一份端点契约，而不会悄悄带上缓存、重试调度器或资源管理器。

## 声明即断言 {#declaration-is-an-assertion}

这六条规则决定了「响应怎么读」的所有问题。编上号，方便以后讨论时直接引用，不必重新推导。

### 1. 你声明的就是你断言的

`output` 的含义是「`ok` 为 true 时，body **就是**这个形状」。`error` 的含义是「`ok` 为 false 时，body **就是**这个形状」。声明不是提示，也不是尽力而为的期望，而是对「会收到什么」的断言。

### 2. `ok` 是唯一分流点，且只走一边

2xx 用 `output` 读。其他一律用 `error` 读。永不两者都试，也不会拿另一边兜底。

### 3. 现实与断言不符就是失败，明确报错

不猜格式、不降级、不沉默。是后端改了、网关插手了，还是有人篡改了响应，**不影响结论**——库分辨不出来，也不该装作能分辨。

这条最常被人希望放宽，所以值得把情况讲明白。假设有个坏蛋能改写你页面本应按 `output` 解析的 `200`，你收到的却是 `3xx`、`4xx` 或 `5xx`。报错不是麻烦，而是唯一安全的结果。「以防万一」把原始 body 交给你，等于给任何能注入响应的人一条绕过你所要求的校验的路。

### 4. 解码失败就没有 body

body **就是**解码后的值。解码失败，就没有值——不存在半成品 body 供你检查。出错细节在 `cause` 上；响应只保留元数据，别的没有。

这一条由类型系统强制，不靠约定：解码 fault 的 `response` 是 `HttpMeta`，根本没有 `body` 字段，去取它就是编译错误。

### 5. 不想被断言约束，就不要声明

省略 `output` 意思是「我不关心 2xx 的 body」——它根本不会被读。省略 `error` 对其余状态同理。这是显式 opt-out，不是遗漏，而且彻底：你 opt out 的那一侧 body 读不出来，不是你的事，连「它读不出来」这个事实本身都不是。

### 6. 3xx 不是错误码区间

如果你知道某个端点会返回重定向状态，就不要给 `output` 传对应的 schema，或者声明一个能接受空值的 schema。否则报错是预期结果，不是缺陷。

## 显式 Client

`createClient(...)` 把 endpoint 配置做成一个明确的值。不同环境或请求作用域，可以有不同的 endpoint、凭证、interceptor、serializer 和 transport handle。

代价是：没有进程级默认 Client。服务端这点反而有用——options 或闭包会抓住鉴权、cookie、用户、租户或请求元数据时，把 Client 建在请求边界里。显式 Client 并不能隔离 interceptor 抓住的状态。Client 身份本身也不是安全边界。

Client 负责分派 command，并不拥有正在进行的工作。谁启动了 HTTP 请求、SSE 流或 WebSocket 会话，谁就要取消或关闭，并 await 终止 promise。

## Definition、endpoint、command

Definition 是稳定契约：method、path、input struct、解码 `ok` 两侧的 struct、传输限制。`defineRequest` 返回 endpoint。调用它会打出一次执行用的 opaque command。

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

后台任务和 UI 可以共用同一个 `getUser` 形状，但取消/重试策略可以不同。保持 command 不透明，能避免业务代码依赖内部传输标签或 symbol。

## 按传输区分的结果

三种传输都用错误优先 tuple。硬塞成一个泛型「response」会抹掉生命周期事实。

- HTTP → `[err, data, response]` — 解码输出 + 产出它的响应
- SSE → `[err, stream, open]` — 一条逻辑流 + 启动响应快照
- WebSocket → `[err, session, connection]` — 逻辑会话 + 启动连接快照

成功时第三项一定在。HTTP 失败是 `[error, undefined, undefined]`：响应元数据已经在 fault 上，而传给 handler、写日志、重新抛出的就是这个 fault。SSE 和 WebSocket 启动失败时，如果已经抓到 open 或 connection 快照，第三项仍可能有。

对 SSE 和 WebSocket，第三项是快照，不是「以后重连还是同一条物理连接」的 promise。启动之后，生命周期控制归返回的 handle 或 session。

## 运行时解码

TypeScript 推断只描述你期望什么，拦不住服务端真返回什么。Struct 解析是契约的另一半。Defjs 在构造请求前校验 command 输入，检查表示，再 parse `ok` 那一侧的 struct。

解码**只发生一次，且在拦截器链之后**。拦截器用 `makeResponse(...)` 造出来的响应，和线上真实来的响应被完全一样地解释：响应从哪来，不影响它怎么被读，所以不存在「信任拦截器」这条需要推敲的岔路。

顺序是：媒体类型，然后表示，然后 Struct。

| 没守住的是                       | Fault                                            |
| -------------------------------- | ------------------------------------------------ |
| 媒体类型不是所声明表示需要的那个 | `RES_MEDIA_TYPE_INVALID`——在读 body **之前**就报 |
| 字节不是那个表示                 | `RES_DECODE_FAILED`                              |
| 值不符合那个 Struct              | `RES_STRUCT_MISMATCH`                            |
| 非 2xx，且 `error` 解出来了      | `HTTP_STATUS`，`data` 带类型                     |
| 非 2xx，且没声明 `error`         | `HTTP_STATUS`，`data: undefined`                 |

先查媒体类型，就是把「我要的是 JSON，收到的是 HTML」变成一个精确的 fault 而不是一个解析器错误，并且整个跳过读取、解析和 Struct。

## Builder、编码器、alias

Struct 是字段契约，两个方向都是。`.alias(name)` 是线上名字。Struct 决定值怎么编码。`builder` 决定这个值放哪。

`builder` 可选、同步、纯。它收到的是 parse 过的 input——真值，不是绑定视图——并返回请求：`path`、`query`、`headers`、`body`。command 执行时才跑。抛错会变成 tuple 上的 `REQ_BUILD_FAILED`；调用 endpoint 本身不抛。input struct 已经是那个请求形状时，省略 `builder`。省略就是 `(input) => input`；input 不能赋给那个形状时，TypeScript 会要求一个 builder。

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

默认路径是把带类型的值交过去。`body: { users: input.users }` 保留每个用户的 alias，所以线上字段是 `display_name`。你自己写的 key（`account_id`、`x-api-version`）是字面量。展开带类型的对象会保住它的 struct；逻辑字段旁边再写线上 key 就是 `REQ_BUILD_FAILED`。

Query 嵌套是后端的事，所以放在 client 上：`withQuerySerializer((query) => string)` 看到的是已经编码的线上对象，alias 包括在内。没有 query 时不会调用。builder 返回的 `URLSearchParams` 会跳过它。没有 serializer 时，数组重复 key，嵌套对象失败。Interceptor 看到的 `queryParams` 是 `new URLSearchParams(queryString)`。

Body kind 按值决定，先匹配的赢：

- 没有 `body` → 什么都不发
- body 根上有 `urlencoded` 或 `formData` codec → 那种表单编码；值嵌在 JSON 里面时这个 tag 不生效
- `FormData`、`URLSearchParams`、`Blob`、`File`、字节，或 `ReadableStream` → 原样发送
- string → `text/plain;charset=UTF-8`
- 其余 → JSON

`undefined` 字段省略。nullable 字段的 `null` 会发出去。string 不是 JSON，除非你自己 stringify 并设 `content-type`。自己序列化（`JSON.stringify`、qs、protobuf）就离开了 struct 编码器，alias 不再生效。没有公开的 `struct.encode`。

`GET` 和 `HEAD` 不能带 body。WebSocket builder 不能返回 headers 或 body。静态 WebSocket 子协议留在 definition 的 `protocols` 上，不进 builder。非法 WebSocket frame 进 session 的 runtime-error 监听。SSE 的 `error` struct 给启动 fault 定类型，握手 body 和 HTTP body 同一套 kind 规则：`string` 是文本，blob 和 file 是 blob，`arrayBuffer` 是字节，其余是 JSON。

## Observer 和政策放哪

Interceptor 管传输级政策：鉴权、追踪、短路、审过的重试。它们只跑自己的传输，按洋葱顺序组合。执行 options 管这次工作的寿命：`signal`、`timeout`、WebSocket heartbeat、可选重连。

Observer 只报告发生了什么，不当第二任所有者。SSE 的 `onInvalidEvent`、WebSocket 状态监听、运行时错误监听，适合有界诊断和指标。返回的 stream/session 仍拥有迭代、关闭、退订和等待终止。缓存、过期结果抑制、幂等、领域错误映射，放在 `client.execute(...)` 周围，业务能看见自己的政策和状态。

## OpenAPI、sourcemap、telemetry

Defjs 不会生成或同步第二份 OpenAPI 契约。OpenAPI 已经是权威源时，继续以它为准，在应用边界加运行时校验。新服务可以直接把端点 definition 和 Struct 当线上契约——不必再搞第二真相源。

`withOpenTelemetryServer(...)` 给 Client 加上**出站** Defjs 埋点。它不会初始化 OpenTelemetry SDK。`tracer` 必填，`meter` 可选，三种传输默认开启，WebSocket query 传播默认关闭。操作名保持静态、低基数。传播、hooks、URL、headers、payload、cause、保留策略都当敏感信息审一遍。

Sourcemap 是部署决策，不是 Defjs 行为。带 `sourcesContent` 的公开 map 会暴露源码；隐藏 map 仍含源码和路径；关掉 map 就没了源码级符号化。把私有 map 当可部署的调试产物，配上明确的访问和保留规则。

## 相关配方

- [声明了 404 的 GET](../recipes/get-declared-404.md)
- [用本地 Fetch handle 做测试](../recipes/test-with-handle.md)
