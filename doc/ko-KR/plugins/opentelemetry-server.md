---
title: OpenTelemetry server
description: 자체 Tracer와 선택적 Meter로 아웃바운드 Defjs 전송 계측을 켜요.
---

# OpenTelemetry server

클라이언트를 만들 때 아웃바운드 계측을 켜요. `@defjs/opentelemetry-server`는 HTTP, SSE, WebSocket 인터셉터를 추가해요. **인바운드** 서버 계측이 아니며, OpenTelemetry SDK를 초기화하지도 **않아요**.

## Basic Setup

SDK는 다른 곳에서 초기화해요. API 객체를 넘겨요.

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { metrics, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const meter = metrics.getMeter('orders-service')
const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer, meter }))

const [error] = await client.execute(readOrders())
if (error) console.error(error.code)
```

`tracer`는 필수예요. `meter`는 선택이에요 — 패키지 메트릭을 끄려면 생략하세요. `propagator`가 없으면 어댑터가 W3C Trace Context + W3C Baggage 복합 propagator를 만들어요. 전역 SDK 설정을 읽거나 초기화하지는 않아요.

`withOpenTelemetryServer(options)`는 core `ClientOption`을 돌려줘요. `createClient` 시점에 적용해 활성 전송마다 인터셉터를 하나 추가하세요. HTTP, SSE, WebSocket은 기본 활성이에요. `{ enabled: false }`로 한 전송을 끌 수 있어요.

어댑터는 요청이 전송 레이어에서 실패해도 전송 텔레메트리를 만들 수 있어요. 내보내지는지는 SDK와 exporter에 달려 있어요.

## 범위

SDK 초기화, provider, exporter, processor, context, sampling, 마스킹, flush, shutdown은 호출하는 쪽이 소유해요. 이 패키지는 넘긴 `Tracer`, 선택 `Meter`, 선택 `TextMapPropagator`를 소비해요. 내장 redactor나 민감 key 정책은 제공하지 않아요.

캐싱, 재시도, 메시지 수준 span, 애플리케이션 명령 결과 정책은 없어요. 서버 측 Node.js용이에요. 게시된 패키지는 Node.js 22+, peer `@defjs/core`, `@opentelemetry/api` 1.x, `@opentelemetry/core` 2.x가 필요해요.

공개 API: `withOpenTelemetryServer`와 `OpenTelemetryServerOptions`, `OpenTelemetryServerHttpOptions`, `OpenTelemetryServerSSEOptions`, `OpenTelemetryServerWebSocketOptions`.

## 옵션과 훅

훅은 바꾸는 전송 옆에 있어요. 동기 `startSpanHook(request)`은 span 생성 전에 실행되어 초기 `Attributes`를 반환해요. 애플리케이션 속성이 마지막에 적용되므로 내장 값을 덮어쓸 수 있어요. `requestHook`과 `responseHook`은 이미 만들어진 span을 받고 `void`나 프로미스를 반환할 수 있어요. Hook 실패는 `defjs.otel.hook.error`를 기록하고 클라이언트 작업을 **멈추지 않아요**. Start hook 실패 시에는 내장 초기 속성을 사용해요.

```typescript twoslash
import { createClient, createResolvedRequestUrl, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    http: {
      startSpanHook(request) {
        const attributes = { 'app.operation': request.operation ?? 'unclassified' }
        if (!request.baseEndpoint) return attributes
        const url = createResolvedRequestUrl(request.baseEndpoint, request.endpoint)
        if (request.queryString) url.search = request.queryString
        url.searchParams.delete('access_token')
        return { ...attributes, 'url.full': url.href }
      },
      requestHook(span, request) {
        span.setAttribute('app.request.started', true)
      },
      responseHook(span, response) {
        span.setAttribute('app.status', response.status)
      },
    },
    sse: { enabled: false },
    webSocket: { enabled: false },
  }),
)

void client
```

훅 시그니처:

- 세 전송 모두: `startSpanHook(request): Attributes` (동기, span 생성 전)
- HTTP: `requestHook(span, request)`와 `responseHook(span, response, request)`
- SSE: `requestHook(span, request)`와 `responseHook(span, stream, request)`
- WebSocket: `requestHook(span, request)`와 `responseHook(span, session, request)`

빈 전송 객체는 그 전송을 켜요. 예전 boolean 전송 스위치와 예전 최상위 훅은 거부돼요 — 전송 옵션 객체와 전송 범위 훅을 쓰세요.

## operation 정체성과 전파

명령에 안정적인 정체성이 있으면 `defineRequest`, `defineEventStream`, `defineWebSocket`에 정적 `operation`을 설정하세요. 어댑터는 span 이름과 `defjs.operation`에 써요. 해석된 path, identifier, 테넌트, query 문자열에서 정체성을 끌어내지 않아요.

```typescript twoslash
import { defineEventStream, defineRequest, defineWebSocket, struct } from '@defjs/core'

const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})
const orderEvents = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  operation: 'orders.watch',
  path: '/orders/events',
  events: { update: struct.object({ id: struct.number() }) },
})
const orderSocket = defineWebSocket({
  maxIncomingQueueSize: 100,
  operation: 'orders.connect',
  path: '/orders/socket',
  incoming: struct.object({ id: struct.number() }),
})

void readOrders
void orderEvents
void orderSocket
```

span 이름은 `GET orders.read`, `SSE orders.watch`, `WebSocket orders.connect`가 돼요. `operation`이 없으면 fallback은 method / `SSE` / `WebSocket`이고, `defjs.operation`은 생략돼요.

HTTP와 SSE는 전파 필드를 요청 헤더에 주입해요. 기존 `Headers` 인스턴스는 재사용·변경되고, 아니면 새 `Headers`를 만들어요. WebSocket query 전파는 **opt-in**이에요 (브라우저는 임의 handshake 헤더를 추가할 수 없어요).

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    webSocket: { queryPropagation: true },
  }),
)
```

`queryPropagation`이면 propagator 필드가 연결 query 문자열에 붙어요. URL 로깅, 프록시 가시성, access log, baggage, 보존을 먼저 검토하세요. `requireParentSpan: true`는 활성 부모가 없으면 span 생성, 전파, 훅, 메트릭을 건너뛰고 `next`를 그대로 호출해요.

## HTTP, SSE, WebSocket 의미

어댑터는 명령 해석의 모든 단계가 아니라 전송 수명을 측정해요.

- **HTTP** — span은 HTTP 인터셉터에서 시작해 Defjs `HttpResponse`를 받는 시점에 끝나요. 미디어 타입 확인, 표현 읽기, Struct 디코딩은 모두 그 뒤라서, 나중에 생긴 `RES_*` fault는 이미 끝난 전송 span을 고칠 수 없어요. 또 span이 체인 안에서 살기 때문에, 전송 계층의 reject는 OTel 관례대로 예외 클래스로 기록되고, 실행이 나중에 배정하는 fault 코드로 기록되지 않아요.
- **SSE** — span은 `stream.closed`가 settle할 때까지 열려 있어요. `sse.connected`, 그다음 `sse.closed` / `sse.aborted` / `sse.error`를 기록해요. 재연결을 포함한 논리 스트림 하나 → span 하나. 이벤트별 span은 없어요.
- **WebSocket** — span은 `session.closed`가 settle할 때까지 열려 있어요. 이벤트: `websocket.connected`, `websocket.closed`, `websocket.error`. 재연결하는 물리 소켓도 논리 세션의 일부예요. 메시지별 span은 없어요.

전송만이 아니라 최종 명령 결과가 필요하면 `client.execute(...)`를 애플리케이션 span으로 감싸세요.

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
const readOrders = defineRequest({ method: 'GET', operation: 'orders.read', path: '/orders' })

const outcome = await tracer.startActiveSpan('orders.command', async (span) => {
  try {
    const outcome = await client.execute(readOrders())
    const [error] = outcome
    if (error) {
      span.setAttribute('error.type', error.code)
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    return outcome
  } finally {
    span.end()
  }
})

void outcome
```

바깥 span은 호출하는 쪽 거예요. 플러그인은 여전히 저수준 전송 span을 보고해요 — 질문이 달라요.

## Reference

`meter`를 넘기면:

| Metric                                       | Meaning                                  |
| -------------------------------------------- | ---------------------------------------- |
| `http.client.request.duration`               | HTTP 요청 기간 (초)                      |
| `defjs.client.sse.connect.duration`          | SSE 핸들이 반환될 때까지의 시간          |
| `defjs.client.sse.connection.duration`       | 핸들 반환 → 종료 close                   |
| `defjs.client.sse.active_streams`            | `closed`가 대기 중인 논리 SSE 핸들       |
| `defjs.client.websocket.connect.duration`    | WebSocket 세션이 반환될 때까지의 시간    |
| `defjs.client.websocket.connection.duration` | 세션 반환 → 종료 close                   |
| `defjs.client.websocket.active_connections`  | `closed`가 대기 중인 논리 WebSocket 세션 |

활성 SSE/WebSocket 계측은 물리 소켓이나 개별 HTTP 시도가 아니라 논리 리소스(재연결 공백 포함)를 세요.

HTTP span은 메서드, 해석된 `url.full`, 가능하면 서버 주소/포트, 받은 응답 status를 기록해요. 기본 `url.full`은 `request.endpoint`를 선택적 `request.baseEndpoint`에 대해 resolve하며, 독립된 `request.queryString`은 붙이지 않아요. 이건 구성 경계이지 sanitization이 아니에요. 완전하거나 마스킹된 애플리케이션 소유 URL이 필요하면 `startSpanHook`으로 구성하세요. status `400+` → span status `ERROR`, status 문자열을 `error.type`으로. status `100..399`는 span status를 비워 둬요. status-zero 전송 결과는 응답 status가 없고, 취소는 status를 비워 두며, 타임아웃/기타 전송 실패는 `NET_TIMEOUT` 또는 `NET_UNREACHABLE`를 써요. 메트릭은 안정적인 차원만 써요. 메서드, 정적 operation, 서버 주소/포트, 응답 status, 저카디널리티 오류 타입이요.

SSE/WebSocket 연결 메트릭은 연결 시간, 논리 연결 기간, 활성 리소스 수, `defjs.result`, operation, 서버 주소/포트, 저카디널리티 실패 타입을 기록해요. 기본적으로 요청/응답 body, 메시지 페이로드, 큐 길이, 메시지별 span은 없어요.

`url.full`과 `recordException(...)`은 민감할 수 있어요. Defjs가 대신 마스킹하지 않아요. Operation 이름과 훅 속성은 허용 목록으로 유지하고, `startSpanHook`이나 SDK processor/exporter에서 마스킹하세요. 개인정보, 카디널리티, 보존, 마스킹을 검토하지 않고 원본 URL, query 문자열, 헤더, baggage, 페이로드를 커스텀 텔레메트리에 복사하지 마세요.

WebSocket query 전파는 브라우저, 프록시, access log, 텔레메트리에 trace context와 baggage를 노출할 수 있어요. 자격 증명 채널이 아니에요. `withCredentials(true)`는 HTTP/SSE용 Fetch credentials이지 — WebSocket 인증이 아니에요.

어댑터는 SDK를 초기화/종료하지 않고, core 클라이언트나 전송 핸들을 dispose하지도 않아요. 텔레메트리를 flush하고 HTTP/SSE/WebSocket 작업을 닫는 건 호출하는 쪽이에요. [인터셉터](../core/interceptors.md), [SSE](../core/sse.md), [WebSocket](../core/web-socket.md)을 보세요.

## 관련 레시피

- [로컬 Fetch 핸들로 테스트하기](../recipes/test-with-handle.md)
- [SSE 스트림 소비하기](../recipes/consume-sse.md)
- [WebSocket 세션 열기](../recipes/websocket-session.md)
