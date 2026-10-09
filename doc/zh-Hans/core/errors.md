---
title: Errors
description: 按一个封闭的 fault code 集合分支处理 404、超时、读不出来的 body 和传输失败。
---

# Errors

处理 404、超时或读不出来的 body，靠的是读 error-first 元组，而不是 catch 抛出。`Fault` 是原生 `Error`（`instanceof Error` 为真），由一个字段判别：`code`。

没有 `kind`。失败的类别就是 code 里第一个 `_` 之前那一段，所以 `NET_TIMEOUT` 是 `NET` 类失败，`RES_STRUCT_MISMATCH` 是 `RES` 类失败。粗分看前缀，精确判断看整个 code。

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

因为这个集合是封闭的，对 `code` 做 `switch` 能真正穷尽：

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

## 稳定的 code

| 类别   | Code                                                                   | 谁得改                         |
| ------ | ---------------------------------------------------------------------- | ------------------------------ |
| `HTTP` | `HTTP_STATUS`                                                          | 对端回了非 2xx；当业务逻辑处理 |
| `REQ`  | `REQ_INPUT_INVALID`、`REQ_OPTIONS_INVALID`、`REQ_BUILD_FAILED`         | 调用方，或端点声明             |
| `NET`  | `NET_ABORTED`、`NET_TIMEOUT`、`NET_UNREACHABLE`、`NET_BODY_INCOMPLETE` | 没人，或者重试                 |
| `RES`  | `RES_MEDIA_TYPE_INVALID`、`RES_DECODE_FAILED`、`RES_STRUCT_MISMATCH`   | 声明和对端得对上               |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`、`EXT_HOOK_FAILED`、`EXT_OBSERVER_FAILED`     | 你挂到流水线上的代码           |
| `CAP`  | `CAP_BUFFER_EXCEEDED`、`CAP_QUEUE_OVERFLOW`                            | 声明的上限，或者消费方的节奏   |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | 宿主运行时                     |

集合是故意封闭的：这正是 `switch` 能穷尽的原因。扩展要报自己的细节就走 `cause`，不是加新 code。

### 各形状带哪些字段

| Code          | `status` | `response`                                       | `data`                                |
| ------------- | -------- | ------------------------------------------------ | ------------------------------------- |
| `HTTP_STATUS` | 总有     | 总有；只有声明过 `error` 且解码成功时才带 `body` | 解码后的 `error` body，或 `undefined` |
| `RES_*`       | 总有     | 总有，只有元数据——**没有 `body`**                | 没有                                  |
| 其余一切      | 没有     | 只有传输层当时已经拿到元数据时才有               | 没有                                  |

`cause` 带着底层的值：struct 不匹配时是 `StructError`，表示读不出来时是解析器的失败，扩展抛什么就是什么。

## 各传输的元组形状

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

HTTP 失败时第三项是 `undefined`：当时存在的响应元数据已经由 fault 带着了。这一点重要，因为你传给 handler、写日志、重新抛出的就是 fault，所以元数据必须跟着它走，而不是搁在它旁边。

SSE 和 WebSocket 的第三项是启动快照，即使启动失败也可能有。handle 或 session 返回之后，后续的失败活在它自己的生命周期上——它们永不改写已经定下来的启动元组。

## body 怎么读

`ok` 是唯一分流点，且只有一边会解码。`output` 读 2xx body；`error` 读其余一切。省略哪个，那个 body 就根本不会被读。

| 情况                                  | 结果                                           |
| ------------------------------------- | ---------------------------------------------- |
| 2xx，声明过 `output`，body 解码成功   | 成功；`data` 和 `response.body` 都带类型       |
| 2xx，省略了 `output`                  | 成功；`data` 是 `undefined`，响应没有 `body`   |
| 非 2xx，声明过 `error`，body 解码成功 | `HTTP_STATUS`，`data` 带类型                   |
| 非 2xx，省略了 `error`                | `HTTP_STATUS`，`data: undefined`               |
| 媒体类型不是那个表示需要的            | `RES_MEDIA_TYPE_INVALID`，在读 body **之前**报 |
| 字节不是那个表示                      | `RES_DECODE_FAILED`                            |
| 值不符合那个 struct                   | `RES_STRUCT_MISMATCH`                          |
| 你**没有**声明的那一侧 body 读不出来  | 整个忽略——见下                                 |

最后一行值得记住。如果你声明了 `output` 而没声明 `error`，那么一个 body 是坏 JSON 的 500，报出来是 `HTTP_STATUS` 加 `status: 500`。你说过你不关心错误 body，这也包括不关心它读不出来这件事。

解码只发生一次，且在拦截器链之后。拦截器用 `makeResponse(...)` 造的响应，和线上来的走同一套媒体类型检查、同一个 struct。

`HttpResponse.ok` 只表示 `200 <= status < 300`。传输失败是 fault，绝不是响应——不存在代表它的 status-0 响应。

## 窄化错误 body 的联合

一个 `error` struct 覆盖所有非 2xx 状态，所以形状不同时你会声明一个联合。之后你能拿 `fault.data` 做什么，完全取决于你怎么声明这个联合——库交还给你的，正是你要求的那个类型。

`struct.or(...)` 产出一个普通联合，TypeScript 自己窄化不了。去测你要的那个字段：

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` 按 body 真正带着的字段窄化。API 本身已经给错误打了标签时，这是最舒服的写法：

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

当 API 把状态放在 body **里面**时，就按它窄化，而不是按 `fault.status`：

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

只要 API 支持，最后这种写法值得优先。`fault.status` 是 HTTP 层的数字，代理、网关或 CDN 都能改写它；而 `data.status` 是从你 `error` struct 断言过的 body 里解码出来的，能取到它就是后端确实产出过它的证明。

一个不带判别字段、因此窄化不了的联合，是声明本身的属性，不是库的——库交给你的就是你声明的类型。想要窄化，就给 struct 加一个判别字段。

## 启动期与开启之后

SSE 在 resolve handle 之前会校验状态、`text/event-stream` 以及 body 是否存在。非 2xx → `HTTP_STATUS`。媒体类型不对 → `RES_MEDIA_TYPE_INVALID`。缺 body → `RES_DECODE_FAILED`。开启快照照样可能落在元组第三项。

WebSocket 的启动期覆盖握手加第一次物理 open。构造器失败、open 之前就关闭、超时或取消，都会产出一个启动元组。即使 socket 从没到过 `open`，连接快照也可能存在。

| 传输      | 启动之后                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| SSE       | 致命错误时迭代器 reject；`stream.closed` 以 `kind: 'error'` 和对应的 fault `code` resolve                                       |
| WebSocket | 消息/队列/心跳失败走 `onRuntimeError`；终止性错误让 `receive` 失败；`session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP      | execute 的 promise 只 settle 一次。拦截器和回调里的代码仍可能在元组归一化之外抛错                                               |

`NET_ABORTED` / `NET_TIMEOUT` 描述的是调用方在启动期看到了什么。返回给你的 stream 或 session，你照样要关掉并 await 它的终态 promise。

## 原生 Error 的日志与 cause

Fault 是原生 `Error` 实例，所以不需要诊断适配器。`String(fault)` 给出稳定的原生形式 `DefjsFault: <message>`。`code` 和各变体字段——`status`、`response`、`data`——保持可枚举，便于结构化日志；`name` 和原生 `cause` 链是不可枚举的。

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

调 `format()`、`flatten()` 或 `prettify()` 之前，先把 `fault.cause` 窄化到 `StructError`。这些 helper 长在 Struct 的 cause 上，不会被复制到 fault 上。不要让控制流去解析 `message` 或 `String(fault)`——契约是 `code` 和一个审过的 `status`。

## 参考

| 分支             | 控制流判断                         | 好用的稳定字段                         | 通常没有／敏感              |
| ---------------- | ---------------------------------- | -------------------------------------- | --------------------------- |
| HTTP 状态策略    | `fault.code === 'HTTP_STATUS'`     | `fault.status`、审过的 `fault.data`    | Body、headers、URL、`cause` |
| 调用方取消       | `fault.code === 'NET_ABORTED'`     | `code`                                 | 取消原因和栈                |
| 超时             | `fault.code === 'NET_TIMEOUT'`     | `code`                                 | 请求 URL 和底层 cause       |
| 契约破了         | `fault.code.startsWith('RES_')`    | `code`、审过的 `fault.response.status` | Struct issue、body、输入值  |
| 你自己的代码抛了 | `fault.code.startsWith('EXT_')`    | `code`、`cause`                        | 扩展挂上来的任何东西        |
| 流／会话运行期   | `stream.closed` / `session.closed` | 终态 `kind` 和 `code`                  | 事件载荷、帧、cause         |

把 `cause`、`data`、响应 headers 和 body、URL、Struct issue、输入值和栈都当敏感信息。一个保守的摘要：

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`、`createPreflightFault`、`createDecodeFault`、`createHttpStatusFault` 和 `createUndecodedHttpStatusFault` 构造这些原生 Error 值。普通的请求失败照样在元组里返回它们；不会因为它们继承了原生 Error 行为就被抛出。`ERR_ABORTED` 和 `ERR_TIMEOUT` 是传输归一化器能认出来的共享 cause。

## 相关配方

- [声明了 404 的 GET](../recipes/get-declared-404.md)
- [取消一次 HTTP 调用](../recipes/cancel-http.md)
