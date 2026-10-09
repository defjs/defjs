---
title: OpenTelemetry server
description: فعّل أجهزة نقل Defjs الصادرة بـ Tracer الخاص بك وMeter اختياري.
---

# OpenTelemetry server

فعّل الأجهزة الصادرة عندما تنشئ العميل. `@defjs/opentelemetry-server` يُلحق معترضات HTTP وSSE وWebSocket. **ليس** أجهزة خادم واردة، و**لا** يهيئ OpenTelemetry SDK.

## الإعداد الأساسي

هيئ الـ SDK في مكان آخر. مرّر كائنات API الخاصة به:

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

`tracer` مطلوب. `meter` اختياري — احذفه لتعطيل مقاييس الحزمة. بلا `propagator` → المحوّل يبني ناشرًا مركّبًا لـ W3C Trace Context + W3C Baggage. لا يقرأ أو يهيئ إعداد SDK العام نيابةً عنك.

`withOpenTelemetryServer(options)` يُرجع `ClientOption` للنواة. طبّقه عند `createClient` حتى يُلحق معترض واحد لكل وسيلة نقل مفعّلة. HTTP وSSE وWebSocket مفعّلة افتراضيًا؛ `{ enabled: false }` يعطّل وسيلة نقل واحدة.

المحوّل يمكن أن ينشئ قياس نقل حتى عندما يفشل الطلب عند طبقة النقل. ما إذا صُدّر شيء يعتمد على SDK والمصدّرين لديك.

## النطاق

أنت تملك تهيئة SDK والمزوّدين والمصدّرين والمعالجات والسياق والعيّنة والحجب والإفراغ والإيقاف. هذه الحزمة تستهلك `Tracer` و`Meter` الاختياري و`TextMapPropagator` الاختياري الذي تمرّره. لا تتضمن redactor أو سياسة مفاتيح حساسة.

بلا تخزين مؤقت أو إعادة محاولات أو spans على مستوى الرسالة أو سياسة نتيجة أمر التطبيق. مقصود لـ Node.js من جانب الخادم. الحزمة المنشورة تحتاج Node.js 22+، وpeers `@defjs/core` و`@opentelemetry/api` 1.x و`@opentelemetry/core` 2.x.

الواجهة العامة: `withOpenTelemetryServer` مع `OpenTelemetryServerOptions` و`OpenTelemetryServerHttpOptions` و`OpenTelemetryServerSSEOptions` و`OpenTelemetryServerWebSocketOptions`.

## الخيارات والخطافات

الخطافات تجلس بجانب وسيلة النقل التي تغيّرها. يعمل `startSpanHook(request)` المتزامن قبل إنشاء span ويعيد `Attributes` أولية؛ تُطبّق سمات التطبيق أخيرًا ويمكنها تجاوز المدمجة. تستقبل `requestHook` و`responseHook` الـ span المنشأ بالفعل ويمكنهما إعادة `void` أو Promise. فشل أي hook يسجّل `defjs.otel.hook.error` ولا يوقف العملية؛ فشل start hook يرجع إلى السمات المدمجة.

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

توقيعات الخطاف:

- جميع وسائل النقل الثلاث: `startSpanHook(request): Attributes` (متزامن، قبل إنشاء span)
- HTTP: `requestHook(span, request)` و`responseHook(span, response, request)`
- SSE: `requestHook(span, request)` و`responseHook(span, stream, request)`
- WebSocket: `requestHook(span, request)` و`responseHook(span, session, request)`

كائن نقل فارغ يفعّل تلك الوسيلة. مفاتيح النقل البوليانية القديمة والخطافات العلوية القديمة مرفوضة — استخدم كائنات خيارات النقل والخطافات محدودة بالنقل.

## هوية العملية والانتشار

اضبط `operation` ثابتًا على `defineRequest` أو `defineEventStream` أو `defineWebSocket` عندما يملك الأمر هوية مستقرة. المحوّل يستخدمها في أسماء الـ span وكـ `defjs.operation`. لا يستنتج الهوية أبدًا من مسار محلول أو معرّف أو مستأجر أو سلسلة استعلام:

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

أسماء الـ span تصبح `GET orders.read` و`SSE orders.watch` و`WebSocket orders.connect`. بلا `operation`، الاحتياطي هو الطريقة / `SSE` / `WebSocket`، و`defjs.operation` يُحذف.

HTTP وSSE يحقنان الحقول المنتشرة في رؤوس الطلب. مثيلات `Headers` الموجودة تُعاد استخدامها وتُعدَّل؛ وإلا يُنشأ `Headers` جديد. انتشار استعلام WebSocket **اختياري** (المتصفحات لا يمكنها إضافة رؤوس مصافحة عشوائية):

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

مع `queryPropagation`، حقول الناشر تُلحق بسلسلة استعلام الاتصال. راجع تسجيل URL ورؤية الوكيل وسجلات الوصول وbaggage والاحتفاظ أولاً. `requireParentSpan: true` يتخطى إنشاء الـ span والانتشار والخطافات والمقاييس عندما لا يوجد والد نشط، ثم يستدعي `next` بلا تغيير.

## دلالات HTTP وSSE وWebSocket

المحوّل يقيس أعمار النقل، لا كل مرحلة من تفسير الأمر.

- **HTTP** — يبدأ الـ span في معترض HTTP وينتهي عند حصوله على `HttpResponse` الخاص بـ Defjs. أما فحص نوع الوسائط وقراءة التمثيل وفكّ Struct فتأتي كلها بعد ذلك، فلا يستطيع خطأ `RES_*` لاحق تحديث span النقل المنتهي. ولأن الـ span يعيش داخل السلسلة، يُسجَّل رفض النقل بصنف الاستثناء وفق عُرف OTel، لا برمز الخطأ الذي يسنده التنفيذ لاحقًا.
- **SSE** — الـ span يبقى مفتوحًا حتى يستقر `stream.closed`. يسجّل `sse.connected`، ثم `sse.closed` / `sse.aborted` / `sse.error`. تدفق منطقي واحد (بما في ذلك إعادة الاتصال) → span واحد. بلا spans لكل حدث.
- **WebSocket** — الـ span يبقى مفتوحًا حتى يستقر `session.closed`. الأحداث: `websocket.connected` و`websocket.closed` و`websocket.error`. المقابس المادية المعيدة للاتصال تبقى جزءًا من الجلسة المنطقية. بلا spans لكل رسالة.

تحتاج نتيجة الأمر النهائية، لا النقل فقط؟ غلّف `client.execute(...)` في span تطبيق:

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

الـ span الخارجي لك. الإضافة ما زالت تُبلّغ عن span النقل الأدنى — سؤالان مختلفان.

## المرجع

عندما يُمرَّر `meter`:

| المقياس                                      | المعنى                                  |
| -------------------------------------------- | --------------------------------------- |
| `http.client.request.duration`               | مدة طلب HTTP (ثوانٍ)                     |
| `defjs.client.sse.connect.duration`          | الوقت حتى إرجاع معالج SSE               |
| `defjs.client.sse.connection.duration`       | إرجاع المعالج → الإغلاق النهائي           |
| `defjs.client.sse.active_streams`            | معالجات SSE منطقية بـ `closed` معلّق     |
| `defjs.client.websocket.connect.duration`    | الوقت حتى إرجاع جلسة WebSocket          |
| `defjs.client.websocket.connection.duration` | إرجاع الجلسة → الإغلاق النهائي            |
| `defjs.client.websocket.active_connections`  | جلسات WebSocket منطقية بـ `closed` معلّق |

أدوات SSE/WebSocket النشطة تعدّ الموارد المنطقية (بما في ذلك فجوات إعادة الاتصال)، لا المقابس المادية أو محاولات HTTP الفردية.

spans HTTP تسجّل الطريقة و`url.full` المحلول وعنوان/منفذ الخادم عند التوفر وحالة الاستجابة عند الاستلام. افتراضيًا يحل `url.full` فقط `request.endpoint` مقابل `request.baseEndpoint` الاختياري، ولا يضيف `request.queryString` مستقلًا. هذا حد بناء لا تنقيح؛ استخدم `startSpanHook` لبناء URL كامل أو منقّح يملكه التطبيق. الحالة `400+` → حالة span `ERROR` مع سلسلة الحالة كـ `error.type`. الحالة `100..399` تترك حالة الـ span غير مضبوطة. نتيجة نقل الحالة صفر بلا حالة استجابة؛ الإلغاء يترك الحالة غير مضبوطة؛ مهلة/أعطال نقل أخرى تستخدم `NET_TIMEOUT` أو `NET_UNREACHABLE`. المقاييس تستخدم أبعادًا مستقرة: الطريقة، العملية الثابتة، عنوان/منفذ الخادم، حالة الاستجابة، نوع خطأ منخفض الكاردينالية.

مقاييس اتصال SSE/WebSocket تسجّل وقت الاتصال ومدة الاتصال المنطقي وعدد الموارد النشطة و`defjs.result` والعملية وعنوان/منفذ الخادم وأنواع فشل منخفضة الكاردينالية. بلا أجسام طلب/استجابة أو حمولات رسائل أو أطوال طابور أو spans لكل رسالة افتراضيًا.

عامل `url.full` و`recordException(...)` كحسّاسين محتملين. Defjs لا ينقحهما نيابةً عنك. أبقِ أسماء العمليات وسمات الخطاف في قائمة مسموح؛ احجب في `startSpanHook` أو معالجات/مصدّري SDK. لا تنسخ عناوين URL الخام أو سلاسل الاستعلام أو الرؤوس أو baggage أو الحمولات إلى قياس مخصص دون مراجعة الخصوصية والكاردينالية والاحتفاظ والحجب.

انتشار استعلام WebSocket يمكن أن يعرّض سياق التتبّع وbaggage للمتصفحات والوكلاء وسجلات الوصول والقياس. ليس قناة اعتماد. `withCredentials(true)` هو بيانات اعتماد Fetch لـ HTTP/SSE — وليست مصادقة WebSocket.

المحوّل لا يهيئ/يوقف SDK، ولا يتخلص من عميل النواة أو معالجات النقل. أنت تفرغ القياس وتغلق عمل HTTP/SSE/WebSocket. انظر [المعترضات](../core/interceptors.md) و[SSE](../core/sse.md) و[WebSocket](../core/web-socket.md).

## وصفات ذات صلة

- [الاختبار بـ Fetch محلي](../recipes/test-with-handle.md)
- [استهلاك تدفق SSE](../recipes/consume-sse.md)
- [فتح جلسة WebSocket](../recipes/websocket-session.md)
