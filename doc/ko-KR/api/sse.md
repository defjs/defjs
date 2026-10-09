---
title: SSE
description: defineEventStream, 실행 options, stream handle이에요.
---

# SSE

이벤트 스트림을 선언하고, 실행하고, 이벤트를 순회한 뒤 닫아요.

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`, `events` map, 선택 `method`(기본 `'GET'`), 선택 `input`, `builder`, `error`, buffer/queue 한도예요.
- **반환** 엔드포인트예요. 입력을 넣어 호출하면 `EventStreamCommand`가 나와요.

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

`client.execute`의 저수준 진입점이에요. 애플리케이션 코드에서는 클라이언트를 쓰는 편이 좋아요.

- **반환** `[null, stream, open]` 또는 `[error, undefined, open?]`예요. `error`를 선언하면 fault는 그 struct의 `Fault`이고, 아니면 `Fault<undefined>`예요.

## 실행 options

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

취소 규칙은 HTTP와 같아요. `abort` 또는 `timeout`이지, 둘 다가 아니에요.

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open`은 시작 스냅샷이에요. 재연결 뒤에는 바뀔 수 있으니 `stream.open`도 읽으세요. 소유한 범위를 정리할 때는 `await using stream = handle`을 선호해요. disposer는 Defjs의 읽기와 재연결 작업을 멈추고 reader lock이 풀릴 때까지 기다려요. provider가 붙잡고 끝나지 않는 `ReadableStream.cancel()` promise가 끝난다고 약속하지는 않아요. 수동 `close()` / `closed`도 그대로 쓸 수 있어요.

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

`EventStreamHandle`의 구조적 구현은 이제 `[Symbol.asyncDispose]()`를 구현하고 같은 소유 teardown 경로를 돌려줘야 해요. 커스텀 handle에는 컴파일 타임 breaking change예요. Defjs가 돌려준 handle만 받는 코드는 런타임에 새 호출이 필요 없어요.

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

`EventStreamFaultCode`: `'CAP_BUFFER_EXCEEDED' | 'CAP_QUEUE_OVERFLOW' | 'EXT_HOOK_FAILED' | 'EXT_OBSERVER_FAILED' | 'NET_TIMEOUT' | 'NET_UNREACHABLE' | 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID'`.

## 이벤트 map

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

`string` 이벤트 struct는 raw `data` 텍스트를 유지해요. 그 밖의 kind는 JSON 텍스트예요. `JSON.parse`한 뒤 struct를 적용해요. 그래서 bare `struct.literal`에는 따옴표 없는 토큰이 아니라 JSON 텍스트가 필요해요. 핸드셰이크 `error` body는 HTTP와 같은 kind 규칙을 써요. `string`은 텍스트, `blob` / `file`은 blob, `arrayBuffer`는 바이트, 그 밖은 JSON이에요.

재연결은 클라이언트에 있어요 (`withSSEReconnect`). SSE `jitter`는 WebSocket과 같은 **0–1 곱셈 계수**예요.

[SSE 가이드](/core/sse)와 [SSE 스트림 소비하기](/recipes/consume-sse)를 보세요.

## EventStreamDefinition {#EventStreamDefinition}

`path`, `events`, 선택 `method` / `input` / `builder` / `error`, buffer와 queue 한도예요. 요청 모양은 `body`를 포함해 HTTP와 같아요. `GET`과 `HEAD`는 body를 돌려줄 수 없어요.

## EventStreamEndpoint {#EventStreamEndpoint}

`defineEventStream`이 돌려줘요. 입력을 넣어 호출하면 `EventStreamCommand`가 나와요.

## EventStreamRequestShape {#EventStreamRequestShape}

스트림의 method와 path에 대한 `HttpRequestShape`와 같은 필드예요.

## EventStreamCommand {#EventStreamCommand}

opaque SSE 명령이에요. `client.execute`에 넘기세요.

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` 또는 `[error, undefined, open?]`예요.

## EventStreamData {#EventStreamData}

`EventStructs` map에서 추론한, 파싱된 이벤트 payload예요.
