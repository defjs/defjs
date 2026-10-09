---
title: SSE
description: defineEventStream、execute options，以及 stream handle。
---

# SSE

声明一条事件流，execute，迭代事件，再 close。

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`、`events` map，可选 `method`（默认 `'GET'`），可选 `input`、`builder`、`error`，以及 buffer/queue 上限。
- **返回** 一个 endpoint。塞 input 调用，得到 `EventStreamCommand`。

```ts twoslash
import { defineEventStream, struct } from '@defjs/core'

const ticks = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/ticks',
  events: { message: struct.object({ text: struct.string() }) },
})
```

## executeEventStreamCommand() {#executeEventStreamCommand}

```ts
function executeEventStreamCommand(
  clientConfig: ClientConfig,
  command: EventStreamCommand,
  options?: EventStreamExecuteOptions,
): Promise<StreamAwaitResult>
```

`client.execute` 的底层入口。业务代码走 client。

- **返回** `[null, stream, open]` 或 `[error, undefined, open?]`。声明了 `error` 时，fault 是那个 struct 的 `Fault`；否则是 `Fault<undefined>`。

## 执行 options

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

取消规则和 HTTP 一样：`abort` 或 `timeout`，别两个一起。

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open` 是启动快照；重连后可能变——也读 `stream.open`。自有作用域优先用 `await using stream = handle` 清理。disposer 会停止 Defjs 的读取和重连任务，并等待 reader lock 释放；它不承诺由 provider 控制且卡住的 `ReadableStream.cancel()` promise 一定完成。手动 `close()` / `closed` 仍可使用。

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

结构化实现 `EventStreamHandle` 的代码现在必须实现 `[Symbol.asyncDispose]()`，并返回同一条自有 teardown 路径。对自定义 handle 实现者而言，这是编译期 breaking change；只接收 Defjs 返回 handle 的代码无需新增运行时调用。

### EventStreamOpenInfo {#EventStreamOpenInfo}

```ts
interface EventStreamOpenInfo {
  response: HttpResponse<unknown>
  url: string
}
```

### EventStreamCloseInfo {#EventStreamCloseInfo}

```ts
type EventStreamCloseInfo =
  | { kind: 'eof'; reason?: string; cause?: unknown }
  | { kind: 'aborted'; reason?: string; cause?: unknown }
  | { kind: 'error'; code: EventStreamFaultCode; reason?: string; cause?: unknown }
```

`EventStreamFaultCode`：`'CAP_BUFFER_EXCEEDED' | 'CAP_QUEUE_OVERFLOW' | 'EXT_HOOK_FAILED' | 'EXT_OBSERVER_FAILED' | 'NET_TIMEOUT' | 'NET_UNREACHABLE' | 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID'`。

## 事件 map

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

`string` 事件 struct 保留原始 `data` 文本。其余 kind 都是 JSON 文本：`JSON.parse`，再交给 struct。所以裸的 `struct.literal` 需要 JSON 文本，不是没加引号的 token。握手 `error` body 用和 HTTP 一样的 kind 规则：`string` 是文本，`blob` / `file` 是 blob，`arrayBuffer` 是字节，其余是 JSON。

重连在 client 上（`withSSEReconnect`）。SSE `jitter` 是 **0–1 的乘性因子**，和 WebSocket 一样。

见 [SSE 指南](/core/sse) 和[消费 SSE 流](/recipes/consume-sse)。

## EventStreamDefinition {#EventStreamDefinition}

`path`、`events`，可选 `method` / `input` / `builder` / `error`，还有 buffer 和 queue 上限。请求形状和 HTTP 一样，包括 `body`。`GET` 和 `HEAD` 不能返回 body。

## EventStreamEndpoint {#EventStreamEndpoint}

`defineEventStream` 的返回值。拿 input 调一下就得到 `EventStreamCommand`。

## EventStreamRequestShape {#EventStreamRequestShape}

和这条流的 method、path 对应的 `HttpRequestShape` 字段相同。

## EventStreamCommand {#EventStreamCommand}

不透明的 SSE command。丢给 `client.execute`。

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` 或 `[error, undefined, open?]`。

## EventStreamData {#EventStreamData}

从 `EventStructs` map 推出来的解析后事件载荷。
