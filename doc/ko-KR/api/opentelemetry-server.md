---
title: '@defjs/opentelemetry-server'
description: withOpenTelemetryServer와 전송별 options예요.
---

# OpenTelemetry server {#page}

나가는 HTTP / SSE / WebSocket 계측을 core interceptor로 붙여요. 이 패키지는 OpenTelemetry SDK를 초기화하지 않고, 들어오는 서버 계측도 아니에요.

[OpenTelemetry server 가이드](/plugins/opentelemetry-server)를 보세요.

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

켠 전송마다 interceptor 하나를 추가해요. `createClient` 때 적용하세요.

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer`는 필수예요. `meter`는 선택 — 안 주면 이 패키지 metrics를 안 남겨요. `propagator` 없음 → W3C Trace Context + Baggage예요.

HTTP, SSE, WebSocket은 기본으로 켜져 있어요. 전송에 `{ enabled: false }`를 주면 건너뛰어요.

## OpenTelemetryServerOptions {#OpenTelemetryServerOptions}

```ts
interface OpenTelemetryServerOptions {
  tracer: Tracer
  meter?: Meter
  propagator?: TextMapPropagator
  requireParentSpan?: boolean
  http?: OpenTelemetryServerHttpOptions
  sse?: OpenTelemetryServerSSEOptions
  webSocket?: OpenTelemetryServerWebSocketOptions
}
```

## OpenTelemetryServerTransportOptions {#OpenTelemetryServerTransportOptions}

### OpenTelemetryServerHttpOptions {#OpenTelemetryServerHttpOptions}

### OpenTelemetryServerSSEOptions {#OpenTelemetryServerSSEOptions}

### OpenTelemetryServerWebSocketOptions {#OpenTelemetryServerWebSocketOptions}

```ts
interface OpenTelemetryServerTransportOptions<TResponse> {
  enabled?: boolean
  startSpanHook?: (request: HttpRequest) => Attributes
  requestHook?: (span: Span, req: HttpRequest) => Promise<void> | void
  responseHook?: (span: Span, res: TResponse, req: HttpRequest) => Promise<void> | void
}

type OpenTelemetryServerHttpOptions = OpenTelemetryServerTransportOptions<HttpResponse<unknown>>
type OpenTelemetryServerSSEOptions = OpenTelemetryServerTransportOptions<EventStreamHandle<unknown>>
interface OpenTelemetryServerWebSocketOptions extends OpenTelemetryServerTransportOptions<WebSocketSessionLike> {
  queryPropagation?: boolean
}
```

`startSpanHook`은 해당 HTTP, SSE, WebSocket 전송의 span을 만들기 전에 동기적으로 실행돼요. 반환한 속성은 내장 속성 뒤에 적용되므로 애플리케이션이 `url.full`이나 다른 초기 값을 덮어쓸 수 있어요. Hook이 throw해도 Defjs는 내장 속성으로 span을 만들고 `defjs.otel.hook.error`를 기록한 뒤 요청을 계속해요. `requestHook`과 `responseHook`은 기존처럼 span 생성 후 실행돼요.

기본 `url.full`은 `request.endpoint`를 선택적인 `request.baseEndpoint`에 대해 resolve할 뿐, 별도 `request.queryString`을 붙이지 않아요. 이 경계는 redaction이 아니고, 패키지에는 내장 redactor나 민감 key 정책이 없어요. 애플리케이션이 소유한 URL을 명시적으로 구성하고 필요하면 민감 값을 지우세요.

```ts
import { createResolvedRequestUrl, type HttpRequest } from '@defjs/core'
import type { Attributes } from '@opentelemetry/api'

const http = {
  startSpanHook(request: HttpRequest): Attributes {
    if (!request.baseEndpoint) return {}
    const url = createResolvedRequestUrl(request.baseEndpoint, request.endpoint)
    if (request.queryString) url.search = request.queryString
    url.searchParams.delete('access_token')
    return { 'url.full': url.href }
  },
}
```

`queryPropagation` 기본값은 `false`예요. WebSocket URL에 trace context를 넣어도 될 때만 켜세요.
