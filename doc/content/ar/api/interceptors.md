---
title: المعترضات
description: منشئات معترضات HTTP وSSE وWebSocket.
---

# المعترضات

غلّف `next` لوسيلة نقل واحدة، أو لاستدعاء عملية كاملة. سجّلها بـ `withInterceptors`. تُصفَّى القوائم المختلطة حسب `kind` عند تشغيل العملية.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

استدعِ `next(req)` (مع طلب معدَّل اختياريًا) أو اقطع السلسلة مبكرًا بـ `makeResponse`. يتجه `next` إلى الداخل فقط: إلى المعترضات المسجَّلة بعد هذا، ثم وسيلة النقل. استدعاؤه مرة أخرى يعيد تشغيل ذلك الجزء الداخلي من هذا المعترض؛ ولا تعمل المعترضات الخارجية مرتين.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` يمتد `AsyncDisposable`. يجب أن يوفّر التنفيذ الهيكلي لقطع السلسلة مبكرًا `[Symbol.asyncDispose](): PromiseLike<void>` ويربطه بدورة حياة الإغلاق نفسها.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` هي الجلسة التي يواجهها المعترض:

<ApiSignature name="WebSocketSessionLike" />

يجب أن يمرّر الغلاف أو جلسة القطع المبكر التفكيك نفسه في `[Symbol.asyncDispose]()` كما في دورة حياة `close` / `closed`؛ وإرجاع وعد محلول لا علاقة له غير كافٍ.

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

ينفّذ `next()` الاستدعاء كله: التحقق من المدخل، واختيار نقطة النهاية، و`builder`، وكل محاولة مع معترضات النقل الخاصة بها وإعادات المحاولة، وفك ترميز الاستجابة. لا يأخذ وسائط وينفّذ الاستدعاء مرة واحدة مهما تكرر استدعاؤه. الدالة معمَّمة على النتيجة، فلا تُحل إلا بما أُحل به `next()`. تعمل معترضات العملية لكل وسيلة نقل، خارج معترضات النقل. يؤدي الإلقاء أو الرفض إلى حل العملية بـ `EXT_INTERCEPTOR_FAILED`، ويُغلق أي تدفق أو جلسة كان الاستدعاء قد فتحها.

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## الأنواع الموسومة

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## المصادقة الأساسية

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

يضع `Authorization: Basic <encoded>` على كل طلب. تُرجع `fn` القيمة `{ username, password }` وتُستدعى لكل طلب. يتلقى الوسيط الثاني الاختياري `{ encode }` بيانات الاعتماد تلك ويُرجع الجزء بعد `Basic `؛ والترميز الافتراضي هو ``btoa(`${username}:${password}`)``. دون `encode`، يُلقي إنشاء المعترض استثناءً عندما لا يتوفر `btoa`.

## حد التزامن

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

يحدّد محاولات HTTP الجارية المتزامنة لكل حزمة (`key`، والافتراضي حزمة واحدة مشتركة). تنتظر الطلبات التي تتجاوز `maxConcurrency` بترتيب FIFO حتى `maxQueue` (الافتراضي `Infinity`)، أو تُرفض بـ `BulkheadOverflowError` (الذي يظهر بوصفه `EXT_INTERCEPTOR_FAILED` مع `{ attempted: false }`). تُحرَّر التصاريح أثناء فترات انتظار التراجع في `withRetry`، وتُحل الطلبات الملغاة مسبقًا أو الملغاة أثناء الانتظار في الطابور بـ `NET_ABORTED` أو `NET_TIMEOUT`. انظر [حدود التزامن والاستدعاءات المجمَّعة](/ar/recipes/concurrency-limit).

## مفتاح عدم التكرار

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

يستنسخ `req.headers` ويضبط `headerName` (الافتراضي `'Idempotency-Key'`) على الطلبات التي يطابق أسلوبها `methods` (الافتراضي `['POST', 'PATCH']`)، متخطيًا الطلبات التي تحمل الترويسة مسبقًا عندما يكون `respectExisting` مساويًا لـ `true` (الافتراضي). دون `generate`، يعيد استخدام `req.correlationId` (أو يرجع إلى UUID v4) بحيث ترسل كل محاولة `withRetry` لاستدعاء واحد المفتاح نفسه؛ ومع `generate`، يخزّن النتيجة مؤقتًا حسب `req.correlationId` في ذاكرة تخزين مؤقت محدودة بـ 4,096 مدخلًا. انظر [مفاتيح عدم التكرار](/ar/recipes/idempotency-key).

انظر [دليل المعترضات](/ar/docs/interceptors).
