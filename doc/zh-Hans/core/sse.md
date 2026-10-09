---
title: Server-Sent Events
description: 消费类型化 SSE 流，关闭它，并 await 终止的 closed promise。
---

# Server-Sent Events

打开流、迭代它，再用 `await using` 释放自有 handle。手动 `close()` 和 `closed` 仍可使用；Client 和插件不会替你释放返回的流。

## 基本用法

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

## 定义流

`defineEventStream(...)` 要 `events`、正 safe integer 的 `maxBufferSize`、正 safe integer 的 `maxQueueSize`，以及相对 `path`。Method 默认 `GET`。

请求形状和 HTTP 一样：可选 `builder`，返回 `path`、`query`、`headers`、`body`。`GET` / `HEAD` 不能返回 body。声明了 `error` struct 时，启动 fault 带类型，非 2xx 握手 body 按 struct kind 解码（`string` 是文本，`blob` / `file` 是 blob，`arrayBuffer` 是字节，其余是 JSON）。你没设 `Accept` 时，Defjs 会发 `Accept: text/event-stream`。

**当你**选择重连时，一条逻辑流可以跨多次物理 Fetch。没有 `withSSEReconnect`，瞬时网络和流读取失败会结束逻辑流。打开成功时你仍拿到一个 handle、一个 async iterator。

## 打开并查看

`client.execute(...)` 只有状态、content-type、body 检查都过了才 resolve：

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

响应必须成功，媒体类型本质是 `text/event-stream`，且有 body。启动非 2xx → `HTTP_STATUS`。声明了 `error` 时，这个 fault 带着解码后的握手 body；媒体类型不对是 `RES_MEDIA_TYPE_INVALID`，body 没法按声明的 kind 读出来是 `RES_DECODE_FAILED`。响应到达后校验失败时，第三项仍可能有响应快照。

`startupOpen` 是初始快照。`stream.open` 是活的，后续物理打开会变。第一次响应重要时，留着 tuple 里的值。

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## 解码事件

线上事件名 → `events[eventName]`；否则 `events.default`。没有匹配 Struct → 事件不投递。缺 SSE `event` 字段 → 逻辑名是 `message`。

SSE `data` 一开始是文本。`string` struct 保留这段文本。其余 kind 都是 JSON：先 parse 文本，再用 struct 解码。`struct.object`、`struct.number`、`struct.boolean`、`struct.any`、`struct.unknown` 都是 JSON，不是 trim 过的文本。`ping` 这种裸 token 满足不了 `struct.literal('ping')`；data 必须是 JSON。服务端发 JSON 字符串 `"abc"` 时仍然满足 `struct.string()`：交付的值就是这段原始文本，引号也在，不会 JSON 解码成 `abc`。

发出的值：`event`、解码后的 `data`、可选非空 `id`。有 `default` 时，未知事件名在推断 union 里是 `string`。

## 观察无效事件

无效/未声明事件会被丢掉，不进队列。`withSSEOnInvalidEvent(...)` 可以观察原始 ID、名字、文本 data，以及 `missing-struct` 或 `validation-failed` 和可选 cause。

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

Observer 跑在 transform 边界。除非当前尝试的 signal 已 abort，它的失败是隔离的。写短一点；别把原始事件 data 当可信输入。

## 重连

**行为变化：** SSE 重连是 opt-in。没有 `withSSEReconnect(...)` 时，网络和流读取失败**不会**重试（等同 `attempts: 0`）。传 `withSSEReconnect({ attempts: 3 })`（或另一份审过的预算）才会重试这些失败。正常 EOF 不重试。状态/content-type 校验、parser 上限、消息 transform 失败、队列溢出、正常 EOF 对逻辑流仍是终端。

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

`attempts` 计的是初次尝试之后的重试次数；设了 reconnect 对象时默认 `3`。`attempts: 0` 禁用重试。不写 `withSSEReconnect` 同样禁用重试。`delayMs` 是初始间隔；`factor` 放大；`maxDelayMs` 封顶基数。SSE 的 `jitter` 是与 WebSocket 相同的 **0–1 乘性因子**。流上的 `retry:` 字段会更新当前间隔。政策回调返回 false / 抛错 / reject 会结束逻辑流。

最近解析到的事件 ID 会在后续尝试变成 `Last-Event-ID`。后续尝试会重发同一条 Fetch 请求，包括 method 和 body。重连前先搞清服务端重放语义。

## Buffer 与队列上限

两者都必须是正 safe integer。溢出是致命的——不会悄悄丢掉旧事件。

| 上限            | 保护什么                        | 终端 code             |
| --------------- | ------------------------------- | --------------------- |
| `maxBufferSize` | 解析时不完整/过大的 SSE 行/事件 | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | 生产快于唯一消费者读取的事件    | `CAP_QUEUE_OVERFLOW`  |

致命流还会清空缓冲事件、取消活动 body、reject iterator，并以 `kind: 'error'` resolve `stream.closed`。

## Close 与 dispose

`EventStreamHandle`：一个活的打开快照、一个终止 promise、一个 `close`、一个 async iterator 和一个标准 async disposer。

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

终端 code：`eof`、`aborted` 或 `error`。`error` 结果还会带 `EventStreamFaultCode`：`CAP_BUFFER_EXCEEDED`、`CAP_QUEUE_OVERFLOW`、`EXT_HOOK_FAILED`、`EXT_OBSERVER_FAILED`、`NET_TIMEOUT`、`NET_UNREACHABLE`、`RES_DECODE_FAILED` 或 `RES_MEDIA_TYPE_INVALID`。

`close(reason)` 中止当前尝试、关闭队列，以 `aborted` settle。循环 `break` / `return` / throw 会触发 iterator return，并以 `iterator-return` 关闭。执行 command 的代码拥有关闭权。

`await using` 调用同一条自有 close 路径，并等待 Defjs 读取/重连任务停止及当前 reader lock 释放。若 provider 控制的 `ReadableStream.cancel()` promise 永久卡住，它并不保证该 promise 完成。需要 reason 或终止结果时，仍可显式调用 `stream.close(reason)`，再 `await stream.closed`。

结构化实现 `EventStreamHandle` 的代码现在必须提供 `[Symbol.asyncDispose](): PromiseLike<void>`，并把它连到同一 lifecycle。对实现者而言，这是编译期 breaking change；只接收 Defjs handle 的消费者无需新增运行时调用。

仓库验证并支持的最低 lib 契约是固定 TypeScript 7 加 `ES2022`、`ESNext.Disposable`、`DOM`、`DOM.Iterable`。这四项组合是一个 baseline；不表示每份 declaration 都分别强制全部四项，也不承诺未经测试的旧 compiler。普通 HTTP Client 不是 `AsyncDisposable`，其请求应使用 timeout 或 `AbortSignal` 管理。

日常日志别带 credentials、事件 data、事件 ID、cause、流 URL。`withCredentials(true)` 影响 SSE 的 Fetch cookie；不配置 WebSocket 鉴权。

## 相关配方

- [消费 SSE 流](../recipes/consume-sse.md)
- [取消一次 HTTP](../recipes/cancel-http.md)
