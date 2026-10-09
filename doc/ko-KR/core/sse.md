---
title: Server-Sent Events
description: 타입이 있는 SSE 스트림을 소비하고, 닫고, 종료된 closed 프로미스를 await 해요.
---

# Server-Sent Events

스트림을 열고, 순회한 뒤, 소유한 핸들을 `await using`으로 놓아요. 수동 `close()`와 `closed`도 그대로 쓸 수 있어요. 클라이언트와 플러그인은 돌려준 스트림을 대신 dispose하지 않아요.

## 기본 사용법

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

## 스트림 정의하기

`defineEventStream(...)`에는 `events`, 양의 안전 정수 `maxBufferSize`, 양의 안전 정수 `maxQueueSize`, 상대 `path`가 필요해요. method 기본값은 `GET`이에요.

요청 모양은 HTTP와 같아요. 선택 `builder`가 `path`, `query`, `headers`, `body`를 돌려줘요. `GET` / `HEAD`는 body를 돌려줄 수 없어요. 선언된 `error` struct는 시작 fault의 타입을 정하고, non-2xx 핸드셰이크 body를 struct kind로 디코딩해요 (`string`은 텍스트, `blob` / `file`은 blob, `arrayBuffer`는 바이트, 그 밖은 JSON). `Accept`를 이미 두지 않았으면 Defjs가 `Accept: text/event-stream`을 보내요.

재연결을 고르면 논리 스트림 하나가 여러 물리 Fetch 시도를 가로지를 수 있어요. `withSSEReconnect`가 없으면 일시적인 네트워크 실패와 스트림 읽기 실패는 논리 스트림을 끝내요. 열기에 성공하면 핸들 하나와 async iterator 하나를 받아요.

## 열고 살펴보기

`client.execute(...)`는 status, content-type, body 검사가 통과한 뒤에만 resolve해요.

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

응답은 성공해야 하고, 미디어 타입 essence는 `text/event-stream`이어야 하고, body가 있어야 해요. non-2xx 시작은 `HTTP_STATUS`예요. `error`를 선언하면 그 fault가 디코딩된 핸드셰이크 body를 가져요. 잘못된 미디어 타입은 `RES_MEDIA_TYPE_INVALID`이고, 선언된 kind로 읽을 수 없는 body는 `RES_DECODE_FAILED`예요. 응답이 도착한 뒤 검증이 실패해도 응답 스냅샷은 튜플의 세 번째 자리에 남을 수 있어요.

`startupOpen`은 처음 스냅샷이에요. `stream.open`은 살아 있고 이후 물리 open에서 바뀌어요. 첫 응답이 중요하면 튜플 값을 붙들어 두세요.

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## 이벤트 디코딩하기

와이어 이벤트 이름은 `events[eventName]`으로 가고, 없으면 `events.default`예요. 맞는 Struct가 없으면 이벤트는 전달되지 않아요. SSE `event` 필드가 없으면 논리 이름은 `message`예요.

SSE `data`는 텍스트로 시작해요. `string` struct는 그 텍스트를 유지해요. 그 밖의 kind는 JSON이에요. 텍스트를 파싱한 뒤 struct로 디코딩해요. `struct.object`, `struct.number`, `struct.boolean`, `struct.any`, `struct.unknown`은 JSON이지, 공백을 자른 텍스트가 아니에요. `ping` 같은 bare 토큰은 `struct.literal('ping')`을 만족하지 않아요. data는 JSON이어야 해요. JSON 문자열 `"abc"`를 보내는 서버도 `struct.string()`을 만족해요. 전달되는 값은 따옴표를 포함한 그 원문이고, JSON 디코딩되어 `abc`가 되지 않아요.

나오는 값은 `event`, 디코딩된 `data`, 선택적인 비어 있지 않은 `id`예요. `default`가 있으면 알 수 없는 이벤트 이름은 추론된 유니언에서 `string`이에요.

## 잘못된 이벤트 관찰하기

잘못되거나 선언되지 않은 이벤트는 큐에 넣지 않고 버려요. `withSSEOnInvalidEvent(...)`는 원본 ID, 이름, 텍스트 data와 `missing-struct` 또는 `validation-failed`, 선택 cause를 관찰할 수 있어요.

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

옵저버는 transform 경계에서 돌아요. 활성 시도 signal이 abort되지 않는 한 실패는 격리돼요. 짧게 두세요. raw 이벤트 data를 신뢰된 값으로 다루지 마세요.

## 재연결

**동작 변경:** SSE 재연결은 opt-in이에요. `withSSEReconnect(...)`가 없으면 네트워크와 스트림 읽기 실패는 재시도되지 **않아요** (`attempts: 0`과 같아요). 그런 실패를 재시도하려면 `withSSEReconnect({ attempts: 3 })`(또는 검토된 다른 예산)를 넘기세요. 정상 EOF는 재시도하지 않아요. status/content-type 검증, 파서 한도, 메시지 transform 실패, 큐 오버플로, 정상 EOF는 논리 스트림의 종료로 남아요.

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

`attempts`는 처음 시도 뒤의 재시도 횟수예요. reconnect 객체를 주면 기본값은 `3`이에요. `attempts: 0`은 재시도를 꺼요. `withSSEReconnect`를 빼도 재시도가 꺼져요. `delayMs`는 처음 간격이고, `factor`가 키우고, `maxDelayMs`가 기본값을 막아요. SSE `jitter`는 WebSocket과 같은 **0–1 곱셈 계수**예요. 스트림 `retry:` 필드는 현재 간격을 갱신해요. 정책 콜백이 false를 돌려주거나 throw/reject하면 논리 스트림이 끝나요.

마지막으로 파싱된 이벤트 ID는 다음 시도의 `Last-Event-ID`가 돼요. 다음 시도는 method와 body를 포함해 같은 Fetch 요청을 다시 보내요. 재연결하기 전에 서버의 재생 의미를 알아 두세요.

## 버퍼와 큐 한도

둘 다 양의 안전 정수여야 해요. 넘치면 치명적이에요. 오래된 이벤트를 조용히 버리지 않아요.

| 한도            | 지키는 것                                      | 종료 code             |
| --------------- | ---------------------------------------------- | --------------------- |
| `maxBufferSize` | 파싱 중 미완성/과대한 SSE 줄/이벤트            | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | 소비자 하나가 읽는 것보다 빨리 만들어진 이벤트 | `CAP_QUEUE_OVERFLOW`  |

치명적 스트림은 버퍼된 이벤트도 지우고, 활성 body를 취소하고, iterator를 reject하고, `stream.closed`를 `kind: 'error'`로 resolve해요.

## 닫고 dispose하기

`EventStreamHandle`은 살아 있는 열기 스냅샷 하나, 종료 프로미스 하나, `close` 하나, async iterator 하나, 표준 async disposer 하나예요.

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

종료 code는 `eof`, `aborted`, `error`예요. `error` 결과는 `EventStreamFaultCode`도 가져요. `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `RES_DECODE_FAILED`, `RES_MEDIA_TYPE_INVALID`예요.

`close(reason)`은 활성 시도를 abort하고, 큐를 닫고, `aborted`로 정해요. 루프의 `break` / `return` / throw는 iterator return을 호출하고 `iterator-return`으로 닫아요. 명령을 실행한 코드가 닫기를 소유해요.

`await using`은 같은 소유 close 경로를 호출하고, Defjs의 읽기/재연결 작업이 멈추고 활성 reader lock이 풀릴 때까지 기다려요. 끝나지 않는 provider 소유의 `ReadableStream.cancel()` promise 주변은 의도적으로 한도가 있어서, 그런 provider promise가 끝났다고 보장하지는 않아요. 이유나 종료 결과가 필요하면 명시적 `stream.close(reason)`과 `await stream.closed`도 유효해요.

커스텀 구조적 `EventStreamHandle` 구현은 이제 `[Symbol.asyncDispose](): PromiseLike<void>`를 제공하고 같은 lifecycle에 연결해야 해요. 구현자에게는 컴파일 타임 breaking change예요. Defjs 핸들만 받는 소비자는 런타임에 새로 호출할 것이 없어요.

저장소에서 검증되고 지원하는 최소 lib 계약은 `ES2022`, `ESNext.Disposable`, `DOM`, `DOM.Iterable`이고, 저장소는 TypeScript 7에 고정돼 있어요. 이 네 항목은 하나의 기준으로 함께 검증돼요. 모든 선언이 각 항목을 독립적으로 강제한다고 말하지 않으며, 시험하지 않은 더 오래된 컴파일러는 약속하지 않아요. 평범한 HTTP 클라이언트는 `AsyncDisposable`이 아니에요. 각 요청은 timeout이나 `AbortSignal`로 관리하세요.

credentials, 이벤트 data, 이벤트 ID, cause, 스트림 URL은 일상적인 로그에서 빼세요. `withCredentials(true)`는 SSE의 Fetch 쿠키에 영향을 줘요. WebSocket 인증은 구성하지 않아요.

## 관련 레시피

- [SSE 스트림 소비하기](../recipes/consume-sse.md)
- [HTTP 호출 취소하기](../recipes/cancel-http.md)
