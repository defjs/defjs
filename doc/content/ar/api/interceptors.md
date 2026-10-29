---
title: المعترضات
description: منشئات معترضات HTTP وSSE وWebSocket.
---

# المعترضات

غلّف `next` لوسيلة نقل واحدة. سجّل بـ `withInterceptors`. القوائم المختلطة تُصفّى حسب النوع عند التنفيذ.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

استدعِ `next(req)` (طلبًا معدَّلًا اختياريًا) أو اختصر المسار بـ `makeResponse`. يتجه `next` إلى الداخل فقط: إلى المعترضات المسجَّلة بعد هذا المعترض، ثم وسيلة النقل. استدعاؤه مرة أخرى يعيد تشغيل ذلك الجزء الداخلي من هذا المعترض؛ ولا تعمل المعترضات الخارجية مرتين.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` يمتد `AsyncDisposable`. أي تنفيذ هيكلي للاختصار يجب أن يوفّر `[Symbol.asyncDispose](): PromiseLike<void>` ويربطه بدورة حياة الإغلاق نفسها.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` هي الجلسة المواجهة للمعترض:

<ApiSignature name="WebSocketSessionLike" />

يجب أن يمرّر الغلاف أو جلسة الاختصار نفس teardown الخاص بـ `[Symbol.asyncDispose]()` كما في دورة حياة `close` / `closed`؛ وإرجاع وعد محلول غير مرتبط لا يكفي. اشتراط هذا العضو تغيير كاسر وقت الترجمة للتطبيقات الهيكلية. الكود الذي يقبل فقط جلسات تعيدها Defjs بلا متطلب استدعاء وقت تشغيل إضافي.

## أنواع بوسم

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## المصادقة الأساسية

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

يعيّن `Authorization: Basic <encoded>` على كل طلب. تُرجع `fn` القيمة `{ username, password }` وتُستدعى لكل طلب. الوسيط الثاني الاختياري `{ encode }` يستلم بيانات الاعتماد هذه ويُرجع الجزء الذي يلي `Basic `؛ والترميز الافتراضي هو ``btoa(`${username}:${password}`)``. بدون `encode`، يرمي إنشاء المعترض عندما لا يتوافر `btoa`.

انظر [دليل المعترضات](/ar/docs/interceptors).
