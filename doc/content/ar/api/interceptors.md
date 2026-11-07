---
title: المعترضات
description: منشئات معترضات HTTP وSSE وWebSocket.
---

# المعترضات

غلّف `next` لوسيلة نقل واحدة. سجّلها بـ `withInterceptors`. تُصفَّى القوائم المختلطة حسب `kind` عند تشغيل العملية.

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

## الأنواع الموسومة

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

يضع `Authorization: Basic <encoded>` على كل طلب. تُرجع `fn` القيمة `{ username, password }` وتُستدعى لكل طلب. يتلقى الوسيط الثاني الاختياري `{ encode }` بيانات الاعتماد تلك ويُرجع الجزء بعد `Basic `؛ والترميز الافتراضي هو ``btoa(`${username}:${password}`)``. دون `encode`، يُلقي إنشاء المعترض استثناءً عندما لا يتوفر `btoa`.

انظر [دليل المعترضات](/ar/docs/interceptors).
