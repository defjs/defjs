---
title: المعترضات
description: طبّق سياسة HTTP وSSE وWebSocket عند حد النقل بترتيب البصلة.
---

# المعترضات

أضف رؤوس مصادقة، أو اقطع نوافذ الصيانة، أو أعد محاولة القراءات الآمنة — دون لمس تحقق الأمر. لكل وسيلة نقل سلسلتها. تحصل على `HttpRequest`؛ تُرجع نتيجة تلك الوسيلة (`HttpResponse` أو معالج تدفق أحداث أو جلسة WebSocket). تحقق المدخل يعمل قبل السلسلة؛ توزيع الحالة والنتائج المفكوكة بعدها.

## الإعداد الأساسي

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

## ترتيب البصلة

`withInterceptors(...items)` يقبل معترضات مختلطة. العميل يصفّي حسب `kind` لوسيلة النقل المختارة ويحافظ على ترتيب التسجيل النسبي. كل معترض قد يعمل قبل `next` وبعده:

| المصنع                       | الطلب         | النتيجة من `next`                     |
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

استدعاءات `withInterceptors(...)` المتعددة تُلحق. ضع المراقبة الواسعة خارج الطفرة/إعادة المحاولة الأضيق عندما يجب أن ترى الطبقة الخارجية النتيجة النهائية.

## استنسخ وأضف رؤوس الطلب

عامل `HttpRequest` الوارد كمملوك للسلسلة. استنسخ `Headers` قبل تغييرها؛ مرّر طلبًا جديدًا إلى `next`:

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

نفس النمط لـ SSE. WebSocket في المتصفح لا يمكنه إضافة رؤوس مصافحة عشوائية — تغيير `request.headers` لن يصادق مقبس متصفح. استخدم بروتوكولًا أو سياسة URL/استعلام أو مصافحة يدعمها الخادم بدلًا من ذلك.

عند استبدال جسم HTTP، استبدل `body` على الطلب المنسوخ. Fetch يتجاهل بيانات تعريف نوع المحتوى القديمة عندما تغيّرت قيمة الجسم. لا تعِد استخدام جسم `ReadableStream` مستهلك.

## اقطع طلبًا قطعًا قصيرًا

يمكنك تخطي `next`، لكن يجب أن تُرجع نوع النتيجة المتوقع. لـ HTTP، `makeResponse(...)` يبني غلافًا متوافقًا:

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

طبقة الأمر ما زالت توزّع حسب الحالة. أعلن struct `error` واحدًا لجانب غير 2xx عندما يحتاج المستدعون `error.data` مُنوَّعًا. القطع القصير لـ SSE أو WebSocket يحتاج مقبضًا/جلسة متوافقين كاملين (وعود الإغلاق، وحالة حية، وملكية، و`[Symbol.asyncDispose]`). الكائنات الجزئية ليست سياسة صالحة. تطبيقات `EventStreamHandle` و`WebSocketSessionLike` الهيكلية تحتاج الآن ذلك المتخلّص القياسي وقت الترجمة؛ والمستهلكون الذين يستقبلون فقط مقابض Defjs بلا متطلب استدعاء وقت تشغيل جديد.

## أعد محاولة القراءات الآمنة

إعادة المحاولة تغيّر السلوك. أبقِ السياسة ضيقة — هذا المثال يعيد محاولة `GET` / `HEAD` / `OPTIONS` القابلة لإعادة التشغيل للحالات `0` و`429` و`502` و`503` و`504`، ويحد `Retry-After` عند 30 ثانية، ويتوقف بعد محاولتين أو عند الإلغاء:

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

لا تعيد هذه الحلقة محاولة أخطاء المعترض/Fetch المرمية — فشل النقل يرفض الوعد بدلًا من أن ينتج حالة تستطيع هذه الحلقة مطابقتها. إعادة محاولة `POST` / `PUT` / `PATCH` / `DELETE` تحتاج بايتات قابلة لإعادة التشغيل، ودعم الخادم، وعقد تكرار آمن، وسياسة حالة مراجعة. إعادة المحاولة مسؤوليتك — النواة لا تصدّر `retryAfter()`.

المعترض الذي يرمي (أو يرفض) خارج هذا المثال يعود إلى المستدعي بصفة `EXT_INTERCEPTOR_FAILED`، والقيمة المرمية على `cause` — راجع [الأخطاء](./errors.md). رمي `ERR_ABORTED` أو `ERR_TIMEOUT` هو الطريقة التي يعبّر بها المعترض عن الإلغاء بدلًا من ذلك.

`next(request)` قد يرفض. فشل النقل خطأ (fault) وليس استجابة بحالة صفر، لذا المعترض الذي يريد ملاحظته يستخدم `try` / `catch` حول `next`. ومع ذلك يبقى إسناد Defjs صحيحًا: الرفض القادم من النقل يظل خطأ `NET_*` ولا يُحمَّل على معترضك.

## غلّف جلسات WebSocket

معترض WebSocket قد يستدعي `next` مرة واحدة على الأكثر. إذا غلّفت الجلسة، فوّض getters الحية وأعضاء دورة الحياة صراحة:

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

نشر جلسة يلتقط `state` / `connection` / `bufferedAmount` مرة. احفظ `closed` و`receive` و`close` وتفويض `[Symbol.asyncDispose]()` نفسه وتنظيف المستمعين ما لم تغيّر الملكية عمدًا. يجب أن يُرجع الغلاف وعد teardown الخاص بالجلسة الداخلية، لا وعدًا محلولًا غير مرتبط. إن أنشأت سلسلة جلسة لا تُسلَّم، تستقر Core وتغلقها؛ وإن أرجع معترض ناجح جلسة مختلفة، تتجاهل Core الجلسة التي أُنشئت.

## المرجع

المصانع تُرجع قيم نقل موسومة:

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — بيانات اعتماد Basic على HTTP
- `basicAuthSSEInterceptor(provider, options?)` — بيانات اعتماد Basic على SSE

`HttpRequest` قد يتضمن `endpoint` و`baseEndpoint` و`method` و`headers` و`body` و`queryParams` و`queryString` و`abort` و`timeout` و`operation` ثابتًا. قيمة تكامل نقل — وليست مدخل المستدعي المحلَّل. `queryParams` هو `new URLSearchParams(queryString)` بعد التسلسل. مُسلسِل الاستعلام المضبوط لا يُستدعى عندما لا ينتج الـ builder استعلامًا، و`URLSearchParams` من الـ builder يُستخدم كما هو. أبقِ تحقق الأمر وتحقق المخرج وتعيين أخطاء المجال في طبقاتها.

مراقبو SSE/WebSocket خطافات دورة حياة، وليست تدفق تحكم. ألغِ اشتراك مستمعي WebSocket عندما ينتهي المالك. أعطال المراقب تتبع عقد النقل؛ المعترض نفسه يمكن أن يرمي أو يرفض.

سجّل قائمة مسموح مراجعة: `operation` ثابت، الطريقة، الحالة، المدة، رمز خطأ مستقر. لا تسجّل عناوين URL المحلولة أو سلاسل الاستعلام أو رؤوس المصادقة أو الأجسام أو الأسباب الخام أو معرّفات أحداث SSE أو حمولات WebSocket افتراضيًا.

بيانات اعتماد Basic هي base64، وليست مشفّرة. استخدم TLS، أبقِ مزوّدي بيانات الاعتماد محدودين بالطلب على الخادم، لا تسجّل الرأس المُولَّد أبدًا. المرمّز الافتراضي هو `globalThis.btoa`؛ مرّر `BasicAuthInterceptorOptions.encode` عندما تفتقر وقت التشغيل إلى `btoa` أو تحتاج مرمّزًا مراجعًا.

المعترض يمكنه فرض سياسة النقل. ليس تحقق مدخل، ولا تفويضًا، ولا ملكية مورد. الكود الذي يبدأ العمل طويل العمر لـ SSE/WebSocket ما زال يستخدم `await using` أو يلغي ويغلق وينتظر الوعد النهائي يدويًا. HTTP العادي محدود بالطلب ويُدار بمهلته / `AbortSignal`؛ `Client` ليس `AsyncDisposable`.

## وصفات ذات صلة

- [حدّث رمز Bearer مرة واحدة عند 401](../recipes/refresh-bearer-once.md)
- [انشر SDK لـ HTTP دون إخفاء execute](../recipes/publish-http-sdk.md)
- [الاختبار بـ Fetch محلي](../recipes/test-with-handle.md)
- [إلغاء استدعاء HTTP](../recipes/cancel-http.md)
