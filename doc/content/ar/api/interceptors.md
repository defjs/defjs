---
title: المعترضات
description: منشئات معترضات HTTP وSSE وWebSocket.
---

# المعترضات

غلّف `next` لوسيلة نقل واحدة. سجّل بـ `withInterceptors`. القوائم المختلطة تُصفّى حسب النوع عند التنفيذ.

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

استدعِ `next(req)` (طلبًا معدَّلًا اختياريًا) أو اختصر المسار بـ `makeResponse`. يتجه `next` إلى الداخل فقط: إلى المعترضات المسجَّلة بعد هذا المعترض، ثم وسيلة النقل. استدعاؤه مرة أخرى يعيد تشغيل ذلك الجزء الداخلي من هذا المعترض؛ ولا تعمل المعترضات الخارجية مرتين.

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` يمتد `AsyncDisposable`. أي تنفيذ هيكلي للاختصار يجب أن يوفّر `[Symbol.asyncDispose](): PromiseLike<void>` ويربطه بدورة حياة الإغلاق نفسها.

## createWebSocketInterceptor()

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` هي الجلسة المواجهة للمعترض:

```ts
interface WebSocketSessionLike extends AsyncDisposable {
  readonly bufferedAmount: number
  readonly connection: WebSocketConnectionInfo
  readonly closed: Promise<WebSocketCloseInfo>
  readonly receive: AsyncIterable<unknown>
  readonly state: WebSocketState
  close(code?: number, reason?: string): void
  [Symbol.asyncDispose](): PromiseLike<void>
  onRuntimeError(listener: (error: unknown) => void): () => void
  onStateChange(listener: (state: WebSocketState) => void): () => void
  send(message: unknown): void
}
```

يجب أن يمرّر الغلاف أو جلسة الاختصار نفس teardown الخاص بـ `[Symbol.asyncDispose]()` كما في دورة حياة `close` / `closed`؛ وإرجاع وعد محلول غير مرتبط لا يكفي. اشتراط هذا العضو تغيير كاسر وقت الترجمة للتطبيقات الهيكلية. الكود الذي يقبل فقط جلسات تعيدها Defjs بلا متطلب استدعاء وقت تشغيل إضافي.

## أنواع بوسم

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

```ts
type Interceptor = HttpInterceptor | SSEInterceptor | WebSocketInterceptor

interface HttpInterceptor {
  kind: 'http'
  fn: InterceptorFn
}
interface SSEInterceptor {
  kind: 'sse'
  fn: SSEInterceptorFn
}
interface WebSocketInterceptor {
  kind: 'web-socket'
  fn: WebSocketInterceptorFn
}
```

## المصادقة الأساسية

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

```ts
function basicAuthHttpInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): HttpInterceptor

function basicAuthSSEInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): SSEInterceptor

type BasicAuthInterceptorOptions = {
  encode?: (credential: { username: string; password: string }) => string
}
```

يعيّن `Authorization: Basic <encoded>` على كل طلب. تُستدعى `fn` لكل طلب. يُرجع `encode` الجزء الذي يلي `Basic `؛ والافتراضي هو `btoa('username:password')`. بدون `encode`، يرمي إنشاء المعترض عندما لا يتوافر `btoa`.

انظر [دليل المعترضات](/ar/docs/interceptors).
