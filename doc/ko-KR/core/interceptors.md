---
title: 인터셉터
description: HTTP, SSE, WebSocket 정책을 전송 경계에서 onion 순서로 쌓아요.
---

# 인터셉터

인증 헤더를 더하거나, 점검 창을 short-circuit하거나, 안전한 읽기를 재시도해요 — 명령 검증은 건드리지 않고. 전송마다 체인이 따로 있어요. `HttpRequest`를 받고, 그 전송의 결과(`HttpResponse`, 이벤트 스트림 핸들, WebSocket 세션)를 돌려줘요. 입력 검증은 체인 전에, status 디스패치와 디코딩된 결과는 그 후에 돌아요.

## Basic Setup

```typescript twoslash
import { createClient, createHttpInterceptor, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit))
void client
```

## Onion 순서

`withInterceptors(...items)`는 혼합 인터셉터를 받아요. 클라이언트는 선택된 전송의 `kind`로 걸러내고 상대 등록 순서를 유지해요. 각 인터셉터는 `next` 전후에 돌 수 있어요.

| Factory                      | Request       | Result from `next`                    |
| ---------------------------- | ------------- | ------------------------------------- |
| `createHttpInterceptor`      | `HttpRequest` | `Promise<HttpResponse<unknown>>`      |
| `createSSEInterceptor`       | `HttpRequest` | `Promise<EventStreamHandle<unknown>>` |
| `createWebSocketInterceptor` | `HttpRequest` | `Promise<WebSocketSessionLike>`       |

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

const order: string[] = []
const first = createHttpInterceptor(async (request, next) => {
  order.push('first:before')
  const response = await next(request)
  order.push('first:after')
  return response
})

const second = createHttpInterceptor(async (request, next) => {
  order.push('second:before')
  const response = await next(request)
  order.push('second:after')
  return response
})

// Request: first:before → second:before → transport
// Return: second:after → first:after
void [first, second, order]
```

`withInterceptors(...)`를 여러 번 호출하면 추가돼요. 바깥 레이어가 최종 결과를 봐야 할 때는 넓은 관측을 좁은 변경/재시도 밖에 두세요.

## 복제하고 요청 헤더 더하기

들어오는 `HttpRequest`는 체인이 소유한다고 보세요. 바꾸기 전에 `Headers`를 복제하고, 새 요청을 `next`에 넘기세요.

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

function readAccessToken(): string | undefined {
  return undefined
}

const bearer = createHttpInterceptor((request, next) => {
  const token = readAccessToken()
  if (!token) return next(request)

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return next({ ...request, headers })
})
```

SSE도 같은 패턴이에요. 브라우저 WebSocket은 임의 handshake 헤더를 추가할 수 없어요 — `request.headers`를 바꿔도 브라우저 소켓을 인증하지 못해요. 프로토콜, URL/query 정책, 또는 서버가 지원하는 handshake를 쓰세요.

HTTP body를 바꿀 때는 복사한 요청의 `body`를 교체해요. body 값이 바뀌면 Fetch는 낡은 content-type 메타데이터를 무시해요. 이미 소비된 `ReadableStream` body를 재사용하지 마세요.

## 요청 short-circuit하기

`next`를 건너뛸 수 있지만, 기대하는 결과 타입을 돌려줘야 해요. HTTP에서는 `makeResponse(...)`가 호환 래퍼를 만들어요.

```typescript twoslash
import { createHttpInterceptor, makeResponse } from '@defjs/core'

function isMaintenanceWindow(): boolean {
  return false
}

const maintenanceGate = createHttpInterceptor(async (_request, next) => {
  if (isMaintenanceWindow()) {
    return makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { message: 'Temporarily unavailable' },
    })
  }

  return next(_request)
})
```

명령 레이어는 여전히 status로 디스패치해요. 호출자가 타입이 잡힌 `error.data`가 필요하면 비 2xx 쪽을 `error` struct 하나로 선언해요. SSE나 WebSocket을 short-circuit하려면 완전한 호환 핸들/세션이 필요해요 (종료 프로미스, live 상태, 소유권, `[Symbol.asyncDispose]`). 부분 객체는 유효한 정책이 아니에요. 구조적인 `EventStreamHandle`과 `WebSocketSessionLike` 구현은 이제 컴파일 시 표준 disposer도 필요하고, Defjs 핸들을 받기만 하는 소비자에는 새 런타임 호출 요구가 없어요.

## 안전한 읽기 재시도

재시도는 동작을 바꿔요. 정책을 좁게 유지하세요 — 이 예는 재생 가능한 `GET` / `HEAD` / `OPTIONS`를 status `0`, `429`, `502`, `503`, `504`에 대해 재시도하고, `Retry-After`를 30초로 제한하며, 두 번 재시도하거나 abort에서 멈춰요.

```typescript twoslash
import { createHttpInterceptor, type HttpRequest, type HttpResponse } from '@defjs/core'

const retryableMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const retryableStatuses = new Set([0, 429, 502, 503, 504])

function isReplayable(request: HttpRequest): boolean {
  return typeof ReadableStream === 'undefined' || !(request.body instanceof ReadableStream)
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get('retry-after')
  if (!value) return 250

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000)

  const date = Date.parse(value)
  return Number.isNaN(date) ? 250 : Math.min(Math.max(0, date - Date.now()), 30_000)
}

function waitForRetryAfter(response: HttpResponse<unknown>, signal?: AbortSignal): Promise<void> {
  const delay = retryAfterMs(response)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(done, delay)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason)
    }

    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (!retryableMethods.has(request.method.toUpperCase()) || !isReplayable(request)) return next(request)

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request)
    if (!retryableStatuses.has(response.status) || attempt >= 2) return response
    await waitForRetryAfter(response, request.abort)
  }
})
```

던져진 인터셉터/Fetch 오류는 이 루프에서 재시도하지 않아요. 전송 실패는 reject 되니까, 이 루프가 맞춰볼 status 자체가 나오지 않아요. `POST` / `PUT` / `PATCH` / `DELETE` 재시도에는 재생 가능한 바이트, 서버 지원, 멱등성 계약, 검토된 status 정책이 필요해요. 재시도는 당신 몫이에요 — Core는 `retryAfter()`를 내보내지 않아요.

이 예시 밖에서 throw(또는 reject)한 인터셉터는 `EXT_INTERCEPTOR_FAILED`로 호출한 쪽에 돌아가고,
던진 값은 `cause`에 실려요 — [오류](./errors.md)를 보세요. 취소를 표현하려면 대신 `ERR_ABORTED`나
`ERR_TIMEOUT`을 throw 해요.

`next(request)`는 reject 할 수 있어요. 전송 실패는 fault이고 status 0 응답이 아니니까, 관찰하려는
인터셉터는 `next`를 `try` / `catch`로 감싸요. 그래도 Defjs의 귀속은 정확해요. 전송에서 온 reject는
`NET_*` fault로 남고, 당신의 인터셉터 탓이 되지 않아요.

## WebSocket 세션 감싸기

WebSocket 인터셉터는 `next`를 최대 한 번만 호출할 수 있어요. 세션을 감싸면 live getter와 수명 멤버를 명시적으로 위임하세요.

```typescript twoslash
import { createWebSocketInterceptor } from '@defjs/core'

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request)

  return {
    get bufferedAmount() {
      return session.bufferedAmount
    },
    get connection() {
      return session.connection
    },
    get state() {
      return session.state
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason)
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]()
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener)
    },
    onStateChange(listener) {
      return session.onStateChange(listener)
    },
    send(message: unknown) {
      session.send(message)
    },
  }
})
```

세션을 spread하면 `state` / `connection` / `bufferedAmount`가 한 번만 스냅샷돼요. 소유권을 일부러 바꾸지 않는 한 `closed`, `receive`, `close`, 정확한 `[Symbol.asyncDispose]()` 위임, 리스너 정리를 보존하세요. Wrapper는 관계없는 resolved promise가 아니라 내부 session의 teardown promise를 반환해야 해요. 체인이 전달되지 않는 세션을 만들면 Core가 settle하고 닫아요. 성공한 인터셉터가 다른 세션을 돌려주면 Core는 만든 세션을 버려요.

## Reference

팩토리는 태그가 달린 전송 값을 돌려줘요.

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — HTTP용 Basic 자격 증명
- `basicAuthSSEInterceptor(provider, options?)` — SSE용 Basic 자격 증명

`HttpRequest`에는 `endpoint`, `baseEndpoint`, `method`, `headers`, `body`, `queryParams`, `queryString`, `abort`, `timeout`, 정적 `operation`이 있을 수 있어요. 전송 통합 값이지 호출자의 파싱된 입력이 아니에요. `queryParams`는 직렬화 뒤의 `new URLSearchParams(queryString)`이에요. 설정된 query serializer는 builder가 query를 만들지 않으면 호출되지 않고, builder의 `URLSearchParams`는 그대로 쓰여요. 명령 검증, 출력 검증, 도메인 오류 매핑은 각자 레이어에 두세요.

SSE/WebSocket 옵저버는 수명 훅이지 제어 흐름이 아니에요. 소유자가 끝날 때 WebSocket 리스너를 구독 해제하세요. 옵저버 실패는 전송 계약을 따르고, 인터셉터 자체는 throw하거나 reject할 수 있어요.

검토된 허용 목록만 로그하세요. 정적 `operation`, 메서드, status, 기간, 안정적인 오류 코드요. 기본적으로 해석된 URL, query 문자열, 인증 헤더, body, 원본 cause, SSE 이벤트 ID, WebSocket 페이로드는 로그하지 마세요.

Basic 자격 증명은 base64이지 암호가 아니에요. TLS를 쓰고, 서버에서는 자격 증명 provider를 요청 범위로 두고, 생성된 헤더를 절대 로그하지 마세요. 기본 인코더는 `globalThis.btoa`예요. 런타임에 `btoa`가 없거나 검토된 인코더가 필요하면 `BasicAuthInterceptorOptions.encode`를 넘기세요.

인터셉터는 전송 정책을 강제할 수 있어요. 입력 검증, 인가, 리소스 소유권은 아니에요. 장기 작업을 시작한 코드는 `await using`을 쓰거나 수동으로 닫고 종료 프로미스를 await해요. 일반 HTTP는 request-scoped이고 timeout / `AbortSignal`로 관리하므로 `Client`는 `AsyncDisposable`이 아니에요.

## 관련 레시피

- [401에서 Bearer 토큰을 한 번 갱신하기](../recipes/refresh-bearer-once.md)
- [execute를 숨기지 않고 HTTP SDK 공개하기](../recipes/publish-http-sdk.md)
- [로컬 Fetch 핸들로 테스트하기](../recipes/test-with-handle.md)
- [HTTP 호출 취소하기](../recipes/cancel-http.md)
