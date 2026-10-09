---
title: 오류
description: 404, 타임아웃, 읽을 수 없는 body, 전송 실패를 닫힌 fault 코드 집합으로 분기해요.
---

# 오류

404, 타임아웃, 읽을 수 없는 body는 throw를 catch하는 게 아니라 error-first 튜플을 읽어서 처리해요. `Fault`는 네이티브 `Error`이고(`instanceof Error`가 참), 판별에 쓰는 필드는 `code` 하나예요.

`kind`는 없어요. 실패의 분류는 code에서 첫 `_` 앞부분 그 자체라서, `NET_TIMEOUT`은 `NET` 실패이고 `RES_STRUCT_MISMATCH`는 `RES` 실패예요. 크게 나눌 때는 접두사를, 정확히 판단할 때는 code 전체를 보세요.

## 기본 사용법

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

집합이 닫혀 있으니 `code`에 대한 `switch`는 빠짐없이 완전해요.

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

## 안정적인 code

| 분류   | Code                                                                   | 누가 고쳐야 하나                                  |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------- |
| `HTTP` | `HTTP_STATUS`                                                          | 상대가 2xx가 아닌 걸 줬어요. 업무 로직으로 다뤄요 |
| `REQ`  | `REQ_INPUT_INVALID`, `REQ_OPTIONS_INVALID`, `REQ_BUILD_FAILED`         | 호출하는 쪽, 아니면 엔드포인트 선언               |
| `NET`  | `NET_ABORTED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `NET_BODY_INCOMPLETE` | 아무도, 아니면 재시도                             |
| `RES`  | `RES_MEDIA_TYPE_INVALID`, `RES_DECODE_FAILED`, `RES_STRUCT_MISMATCH`   | 선언과 상대를 맞춰야 해요                         |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`     | 당신이 파이프라인에 붙인 코드                     |
| `CAP`  | `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`                            | 선언한 한계, 아니면 소비하는 쪽의 속도            |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | 호스트 런타임                                     |

집합을 닫아 둔 건 의도예요. 그게 `switch`의 완전성을 지켜요. 확장은 자기 세부를 새 code가 아니라 `cause`로 알려요.

### 모양별 필드

| Code          | `status` | `response`                                               | `data`                                  |
| ------------- | -------- | -------------------------------------------------------- | --------------------------------------- |
| `HTTP_STATUS` | 항상     | 항상. `error`를 선언하고 디코딩됐을 때만 `body`를 가져요 | 디코딩된 `error` body, 또는 `undefined` |
| `RES_*`       | 항상     | 항상, 메타데이터만 — **`body` 없음**                     | 없음                                    |
| 그 외 전부    | 없음     | 전송이 이미 메타데이터를 갖고 있던 경우에만              | 없음                                    |

`cause`는 밑단의 값을 실어요. struct 불일치면 `StructError`, 표현을 읽을 수 없으면 파서의 실패, 확장이 던진 것이면 그것 그대로예요.

## 전송별 튜플 모양

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
  [err: null, data: unknown, response: DecodedResponse<unknown> | HttpMeta] | [err: Fault, data: undefined, response: undefined]
type SseResult =
  | [err: null, stream: EventStreamHandle<unknown>, open: EventStreamOpenInfo]
  | [err: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]
type SocketResult =
  | [err: null, session: WebSocketSession<unknown>, connection: WebSocketConnectionInfo]
  | [err: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const results: [HttpResult, SseResult, SocketResult] | undefined = undefined
void results
```

HTTP 실패에서는 세 번째 자리가 `undefined`예요. 있었던 응답 메타데이터는 이미 fault가 들고 있어요. 이게 중요한 이유는, 핸들러에 넘기고 로그에 남기고 다시 던지는 대상이 바로 fault이기 때문이에요. 메타데이터는 fault _옆_ 이 아니라 fault와 _함께_ 움직여야 해요.

SSE와 WebSocket에서 세 번째 자리는 시작 시점 스냅샷이고, 시작이 실패했을 때도 있을 수 있어요. 핸들이나 세션이 돌아온 뒤의 실패는 그 생명주기에서 다뤄요. 이미 정해진 시작 튜플을 고쳐 쓰는 일은 절대 없어요.

## body를 읽는 방법

`ok`가 유일한 분기점이고, 디코딩하는 쪽은 항상 한쪽뿐이에요. `output`은 2xx body를 읽고, `error`는 그 밖의 모든 것을 읽어요. 한쪽을 빼면 그 body는 읽히지 않아요.

| 상황                                       | 결과                                                  |
| ------------------------------------------ | ----------------------------------------------------- |
| 2xx, `output` 선언, body 디코딩 성공       | 성공. `data`와 `response.body`에 타입이 잡혀요        |
| 2xx, `output` 생략                         | 성공. `data`는 `undefined`이고 응답에 `body`가 없어요 |
| non-2xx, `error` 선언, body 디코딩 성공    | 타입이 잡힌 `data`를 지닌 `HTTP_STATUS`               |
| non-2xx, `error` 생략                      | `data: undefined`인 `HTTP_STATUS`                     |
| 미디어 타입이 그 표현이 요구하는 것과 다름 | `RES_MEDIA_TYPE_INVALID`, body를 읽기 **전에** 보고   |
| 바이트가 그 표현이 아님                    | `RES_DECODE_FAILED`                                   |
| 값이 그 struct가 아님                      | `RES_STRUCT_MISMATCH`                                 |
| **선언하지 않은** 쪽의 body를 읽을 수 없음 | 완전히 무시 — 아래 참고                               |

기억해 둘 만한 건 마지막 줄이에요. `output`을 선언하고 `error`를 선언하지 않았다면, body가 깨진 JSON인 500은 `HTTP_STATUS`와 `status: 500`으로 보고돼요. 당신은 오류 body에 신경 쓰지 않는다고 말한 거고, 거기엔 "읽을 수 없었다는 사실에도 신경 쓰지 않는다"가 포함돼요.

디코딩은 인터셉터 체인 뒤에서 딱 한 번 일어나요. 인터셉터가 `makeResponse(...)`로 만든 응답도 회선에서 온 것과 같은 미디어 타입 확인과 같은 struct를 지나요.

`HttpResponse.ok`는 `200 <= status < 300`만 뜻해요. 전송 실패는 fault이고 응답이 아니에요. 그 자리를 대신하는 status 0 응답은 없어요.

## 오류 body union 좁히기

하나의 `error` struct가 2xx 아닌 모든 status를 담당하니, 모양이 다를 때는 union을 선언해요. 그다음 `fault.data`로 무엇을 할 수 있는지는 그 union을 어떻게 선언했는지에 전적으로 달려 있어요. 라이브러리는 당신이 요구한 타입을 그대로 돌려줘요.

`struct.or(...)`는 평범한 union을 만들고, TypeScript는 그걸 혼자 좁히지 못해요. 필요한 필드를 검사하세요.

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)`은 body가 실제로 지닌 필드로 좁혀요. API가 이미 오류에 태그를 달아 뒀다면 이게 가장 편한 형태예요.

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

API가 status를 **body 안에** 넣어 두면, `fault.status` 대신 그걸로 판별하세요.

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

API가 지원한다면 마지막 형태를 고를 만해요. `fault.status`는 HTTP 계층의 숫자라 프록시, 게이트웨이, CDN이 고쳐 쓸 수 있어요. 반면 `data.status`는 당신의 `error` struct가 단언한 body에서 디코딩된 값이라, 거기에 닿았다는 것 자체가 백엔드가 그걸 냈다는 증거예요.

판별 필드가 없어서 좁혀지지 않는 union은 선언 쪽의 성질이고 라이브러리의 성질이 아니에요. 라이브러리는 당신이 선언한 타입을 건네줘요. 좁히고 싶다면 struct에 판별 필드를 더하세요.

## 시작 시점과 열린 뒤

SSE는 핸들을 resolve하기 전에 status, `text/event-stream`, body 존재 여부를 검증해요. non-2xx → `HTTP_STATUS`. 미디어 타입이 다름 → `RES_MEDIA_TYPE_INVALID`. body 없음 → `RES_DECODE_FAILED`. 시작 스냅샷은 그래도 튜플 세 번째 자리에 담길 수 있어요.

WebSocket의 시작 시점은 핸드셰이크와 첫 물리 open까지예요. 생성자 실패, open 전 종료, 타임아웃, 취소는 모두 시작 튜플을 만들어요. 소켓이 `open`에 닿지 못했더라도 연결 스냅샷은 있을 수 있어요.

| 전송      | 시작 이후                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SSE       | 치명적 오류에서 이터레이터가 reject. `stream.closed`는 `kind: 'error'`와 fault의 `code`로 resolve                                         |
| WebSocket | 메시지／큐／하트비트 실패는 `onRuntimeError`. 종단 오류에서 `receive`가 실패. `session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP      | execute의 promise는 한 번만 settle. 인터셉터와 콜백 코드는 튜플 정규화 밖에서 여전히 throw할 수 있어요                                    |

`NET_ABORTED` / `NET_TIMEOUT`은 호출자가 시작 시점에 본 것을 설명해요. 돌려받은 stream이나 session은 그래도 닫고 종단 promise를 await 하세요.

## 네이티브 Error 로깅과 cause

Fault는 네이티브 `Error` 인스턴스라서 진단 어댑터가 필요 없어요. `String(fault)`는 안정적인 네이티브 형태 `DefjsFault: <message>`를 줘요. `code`와 각 변형 필드 — `status`, `response`, `data` — 는 구조화 로깅을 위해 열거 가능하게 남고, `name`과 네이티브 `cause` 체인은 열거되지 않아요.

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

`format()`, `flatten()`, `prettify()`를 부르기 전에 `fault.cause`를 `StructError`로 좁히세요. 이 helper들은 Struct 쪽 cause에 붙어 있고 fault로 복사되지 않아요. 제어 흐름이 `message`나 `String(fault)`를 파싱하게 하지 마세요. 계약은 `code`와 검토된 `status`예요.

## 참고

| 분기                | 제어 흐름 판정                     | 쓸 만한 안정 필드                      | 보통 없음／민감                |
| ------------------- | ---------------------------------- | -------------------------------------- | ------------------------------ |
| HTTP status 정책    | `fault.code === 'HTTP_STATUS'`     | `fault.status`, 검토된 `fault.data`    | body, headers, URL, `cause`    |
| 호출자 취소         | `fault.code === 'NET_ABORTED'`     | `code`                                 | 취소 이유와 스택               |
| 타임아웃            | `fault.code === 'NET_TIMEOUT'`     | `code`                                 | 요청 URL과 밑단 cause          |
| 계약이 깨짐         | `fault.code.startsWith('RES_')`    | `code`, 검토된 `fault.response.status` | Struct issue, body, 입력값     |
| 당신 코드가 던짐    | `fault.code.startsWith('EXT_')`    | `code`, `cause`                        | 확장이 붙인 무엇이든           |
| 스트림／세션 런타임 | `stream.closed` / `session.closed` | 종단 `kind`와 `code`                   | 이벤트 페이로드, 프레임, cause |

`cause`, `data`, 응답 headers와 body, URL, Struct issue, 입력값, 스택은 민감 정보로 다루세요. 보수적인 요약은 이래요.

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`, `createPreflightFault`, `createDecodeFault`, `createHttpStatusFault`, `createUndecodedHttpStatusFault`가 이 네이티브 Error 값들을 만들어요. 평범한 요청 실패는 여전히 튜플로 돌아오고, 네이티브 Error 동작을 물려받았다는 이유만으로 던져지지는 않아요. `ERR_ABORTED`와 `ERR_TIMEOUT`은 전송 정규화기가 알아보는 공유 cause예요.

## 관련 레시피

- [선언된 404가 있는 GET](../recipes/get-declared-404.md)
- [HTTP 호출 취소하기](../recipes/cancel-http.md)
