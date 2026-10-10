---
title: Server-Sent Events
description: Consume typed SSE stream，close 佢，再 await terminal closed promise。
---

# Server-Sent Events

開 stream、iterate 佢，再用 `await using` release 自己 own 嘅 handle。Manual `close()` 同 `closed` 仍然用得；clients 同 plugins 唔會代你 dispose return 出嚟嘅 stream。

## Basic Setup

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

## Define 條 stream

`defineEventStream(...)` 要 `events`、positive safe-integer `maxBufferSize`、positive safe-integer `maxQueueSize`，同 relative `path`。Method 預設 `GET`。

Request shape 同 HTTP 一樣：`builder` return `path`、`query`、`headers` 同 `body`。`GET` / `HEAD` 唔可以 return body。聲明過嘅 `error` struct 會 type 住 startup fault，並按 struct kind decode 非 2xx handshake body（`string` 係 text，`blob` / `file` 係 blob，`arrayBuffer` 係 bytes，否則 JSON）。你未 set `Accept` 時，Defjs 會送 `Accept: text/event-stream`。只要聲明咗 `input`，就必須明確提供 `builder`，即使 input 已經係 request shape 都一樣。只有冇 `input` 嘅定義先可以省略 `builder`。

一條 logical stream **只有**你 opt in reconnect 先可以跨幾次 physical Fetch attempts。冇 `withSSEReconnect`，短暫嘅 network 同 stream-read failures 就會完結條 logical stream。Open 成功之後你仍然只有一個 handle 同一個 async iterator。

## Open 同 inspect

`client.execute(...)` 淨係喺 status、content-type 同 body checks 通過之後先 resolve：

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

Response 一定要 successful，media type essence `text/event-stream`，同埋有 body。Non-2xx startup → `HTTP_STATUS`。聲明過 `error` 嘅時候，嗰個 fault 會帶住 decoded handshake body；media type 唔啱係 `RES_MEDIA_TYPE_INVALID`，body 讀唔成已聲明 kind 就係 `RES_DECODE_FAILED`。Validation 喺 response 到咗之後先 fail 時，response snapshot 仍然可以坐喺 tuple 第三格。

`startupOpen` 係 initial snapshot。`stream.open` 係 live，之後嘅 physical opens 會變。第一次 response 重要時，keep 住 tuple value。

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## Decode events

Wire event name → `events[eventName]`；否則 `events.default`。冇 matching Struct → event 唔 deliver。Missing SSE `event` field → logical name `message`。

SSE `data` 一開始係 text。`string` struct 會保留嗰段 text。其他 kind 都係 JSON：先 parse text，再用 struct decode。`struct.object`、`struct.number`、`struct.boolean`、`struct.any` 同 `struct.unknown` 都係 JSON，唔係 trimmed text。`ping` 呢類 bare token 唔滿足 `struct.literal('ping')`；data 一定要係 JSON。Server 送 JSON string `"abc"` 時仍然滿足 `struct.string()`：交付嘅值就係嗰段原始 text，引號都喺度，唔會 JSON decode 成 `abc`。

Emitted value：`event`、decoded `data`、optional non-empty `id`。有 `default` 時，unknown event names 喺 inferred union 入面係 `string`。

## Observe invalid events

Invalid/undeclared events 會被 drop，唔會 queue。`withSSEOnInvalidEvent(...)` 可以 observe raw ID、name、text data，再加 `missing-struct` 或者 `validation-failed`，同 optional cause。

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

Observer 喺 transform boundary run。除非 active attempt signal aborted，否則佢嘅 failure 係 isolated。Keep 佢短；唔好將 raw event data 當 trusted。

## Reconnect

**行為改變：** SSE reconnect 係 opt-in。冇 `withSSEReconnect(...)`，network 同 stream-read failures **唔會** retry（等同 `attempts: 0`）。要 retry 呢啲 failures，就傳 `withSSEReconnect({ attempts: 3 })`（或者其他 reviewed budget）。Normal EOF 唔會 retry。Status/content-type validation、parser limits、message transform failures、queue overflow，同 normal EOF 對 logical stream 仍然係 terminal。

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

`attempts` 計嘅係 initial attempt 之後嘅 retries；reconnect object 有 set 嘅時候預設 `3`。`attempts: 0` 關閉 retry。唔寫 `withSSEReconnect` 亦會關閉 retry。`delayMs` 係 initial interval；`factor` 會長大佢；`maxDelayMs` cap base。SSE `jitter` 同 WebSocket 一樣，係 **0–1 multiplicative factor**。Stream `retry:` field 會 update 而家嘅 interval。Policy callback return false / throw / reject 會完結 logical stream。

Latest parsed event ID 會喺之後嘅 attempt 變成 `Last-Event-ID`。之後嘅 attempt 會重送同一個 Fetch request，包括 method 同 body。Unbounded reconnect 之前，先搞清楚 server 嘅 replay semantics。

## Buffer 同 queue limits

兩個都一定要係 positive safe integers。Overflow 係 fatal — 唔會 silent discard 舊 events。

| Limit           | Protects                                       | Terminal code         |
| --------------- | ---------------------------------------------- | --------------------- |
| `maxBufferSize` | Parsing 時 incomplete/oversized SSE line/event | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | Events 產出快過唯一個 consumer 讀              | `CAP_QUEUE_OVERFLOW`  |

Fatal stream 亦會清 buffered events、cancel active body、reject iterator，再用 `kind: 'error'` resolve `stream.closed`。

## Close 同 dispose

`EventStreamHandle`：一個 live opening snapshot、一個 terminal promise、一個 `close`、一個 async iterator，同一個 standard async disposer。

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

Terminal codes：`eof`、`aborted` 或者 `error`。`error` result 亦會帶 `EventStreamFaultCode`：`CAP_BUFFER_EXCEEDED`、`CAP_QUEUE_OVERFLOW`、`EXT_HOOK_FAILED`、`EXT_OBSERVER_FAILED`、`NET_TIMEOUT`、`NET_UNREACHABLE`、`RES_DECODE_FAILED` 或者 `RES_MEDIA_TYPE_INVALID`。

`close(reason)` 會 abort active attempt、close queue、settle 成 `aborted`。Loop `break` / `return` / throw 會 invoke iterator return，再用 `iterator-return` close。Execute command 嘅 code own closure。

`await using` 會 call 同一條 owned close path，再等 Defjs 嘅 read/reconnect work 停低，同 active reader lock release。佢刻意 bound 住一條永遠唔 settle、由 provider 控制嘅 `ReadableStream.cancel()` promise，所以唔保證嗰個 provider promise 已經完成。要 reason 或 terminal result 時，仍然可以 explicit `stream.close(reason)`，再 `await stream.closed`。

自己 structural implement `EventStreamHandle` 嘅 code，而家必須 provide `[Symbol.asyncDispose](): PromiseLike<void>`，再接去同一個 lifecycle。對 implementer 嚟講係 compile-time breaking change；淨係接收 Defjs handle 嘅 consumer 唔使加新 runtime call。

Repository 驗證同 support 嘅最低 lib contract 係 `ES2022`、`ESNext.Disposable`、`DOM` 同 `DOM.Iterable`，repository pin 喺 TypeScript 7。呢四項係一齊驗證嘅一個 baseline；唔代表每份 declaration 都各自強制晒每一項，亦唔承諾未測試過嘅舊 compiler。普通 HTTP client 唔係 `AsyncDisposable`，每個 request 要用佢嘅 timeout 或 `AbortSignal` manage。

Keep credentials、event data、event IDs、causes 同 stream URLs 出日常 logs。`withCredentials(true)` 影響 SSE 嘅 Fetch cookies；佢唔會 configure WebSocket auth。

## Related recipes

- [Consume an SSE stream](../recipes/consume-sse.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
