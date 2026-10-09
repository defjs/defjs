---
title: SSE
description: defineEventStream、execute options、stream handle です。
---

# SSE

イベントストリームを宣言し、実行し、イベントを反復してから閉じます。

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`、`events` マップ、任意の `method`（デフォルト `'GET'`）、任意の `input`、`builder`、`error`、バッファ/キュー上限です。
- **戻り値** エンドポイントです。入力を渡して呼ぶと `EventStreamCommand` になります。

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

`client.execute` の低レベル入口です。アプリコードではクライアントを使ってください。

- **戻り値** `[null, stream, open]`、または `[error, undefined, open?]` です。`error` を宣言していれば fault はその struct の `Fault` で、していなければ `Fault<undefined>` です。

## 実行 options

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

キャンセル規則は HTTP と同じです。`abort` か `timeout` の一方だけで、両方は使えません。

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open` は起動時スナップショットです。再接続のあとは変わり得るので、`stream.open` も読んでください。所有するスコープのクリーンアップには `await using stream = handle` を選んでください。disposer は Defjs の読み取りと再接続を止め、reader lock が解放されるのを待ちます。provider が制御する、止まった `ReadableStream.cancel()` の promise が終わることは約束しません。手動の `close()` / `closed` も残っています。

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

`EventStreamHandle` の構造的実装は、今や `[Symbol.asyncDispose]()` を実装し、同じ所有 teardown 経路を返す必要があります。独自ハンドルにとってはコンパイル時の破壊的変更です。Defjs が返すハンドルを受け取るだけのコードには、新しい実行時呼び出しは要りません。

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

`EventStreamFaultCode` は `'CAP_BUFFER_EXCEEDED' | 'CAP_QUEUE_OVERFLOW' | 'EXT_HOOK_FAILED' | 'EXT_OBSERVER_FAILED' | 'NET_TIMEOUT' | 'NET_UNREACHABLE' | 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID'` です。

## イベント map

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

`string` のイベント struct は生の `data` テキストを保ちます。それ以外の kind は JSON テキストです。`JSON.parse` してから struct です。だから裸の `struct.literal` には、引用のないトークンではなく JSON テキストが要ります。ハンドシェイクの `error` ボディは HTTP と同じ kind 規則です。`string` はテキスト、`blob` / `file` は blob、`arrayBuffer` はバイト列、それ以外は JSON です。

再接続はクライアントにあります（`withSSEReconnect`）。SSE の `jitter` は WebSocket と同じ、**0–1 の乗法因子**です。

[SSE ガイド](/core/sse) と [SSE ストリームを消費する](/recipes/consume-sse) を見てください。

## EventStreamDefinition {#EventStreamDefinition}

`path`、`events`、任意の `method` / `input` / `builder` / `error`、バッファとキューの上限です。リクエストの形は HTTP と同じで、`body` も含みます。`GET` と `HEAD` はボディを返せません。

## EventStreamEndpoint {#EventStreamEndpoint}

`defineEventStream` の戻り値です。入力を渡して呼ぶと `EventStreamCommand` になります。

## EventStreamRequestShape {#EventStreamRequestShape}

ストリームの method と path に対する、`HttpRequestShape` と同じフィールドです。

## EventStreamCommand {#EventStreamCommand}

不透明な SSE コマンドです。`client.execute` に渡します。

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` または `[error, undefined, open?]` です。

## EventStreamData {#EventStreamData}

`EventStructs` のマップから推論した、パース済みイベントペイロードです。
