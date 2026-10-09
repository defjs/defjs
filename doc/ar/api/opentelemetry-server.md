---
title: '@defjs/opentelemetry-server'
description: withOpenTelemetryServer وخيارات كل وسيلة نقل.
---

# OpenTelemetry server {#page}

أجهزة صادرة لـ HTTP / SSE / WebSocket كمعترضات أساسية. هذه الحزمة لا تهيئ OpenTelemetry SDK، وليست أجهزة خادم واردة.

انظر [دليل خادم OpenTelemetry](/plugins/opentelemetry-server).

## withOpenTelemetryServer() {#withOpenTelemetryServer}

```ts
function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption
```

يُلحق معترضًا واحدًا لكل وسيلة نقل مفعّلة. طبّقه عند `createClient`.

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
```

`tracer` مطلوب. `meter` اختياري — احذفه لتخطي مقاييس الحزمة. بلا `propagator` → W3C Trace Context + Baggage.

HTTP وSSE وWebSocket مفعّلة افتراضيًا. مرّر `{ enabled: false }` على وسيلة نقل لتخطيها.

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

يعمل `startSpanHook` بشكل متزامن قبل إنشاء الـ span لوسيلة HTTP أو SSE أو WebSocket الخاصة به. تُطبَّق سماته بعد السمات المدمجة، فيجوز للتطبيق أن يتجاوز `url.full` أو قيمة أولية أخرى. إذا رمى، تنشئ Defjs الـ span بالسمات المدمجة، وتسجّل `defjs.otel.hook.error`، وتكمل الطلب؛ وتُبقي `requestHook` و`responseHook` دلالاتهما القائمة بعد الإنشاء.

افتراضيًا، يحل `url.full` فقط `request.endpoint` مقابل `request.baseEndpoint` الاختياري؛ ولا يُلحَق `request.queryString` مستقل. ذلك الحد ليس حجبًا، والحزمة بلا حاجب مدمج أو سياسة مفاتيح حسّاسة. ابنِ عنوان URL مملوكًا للتطبيق، واحجبه إن لزم، صراحة:

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

`queryPropagation` افتراضيًا `false`. فعّله فقط بعد أن تقبل سياق التتبع في عنوان WebSocket.
