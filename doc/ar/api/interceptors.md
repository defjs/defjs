---
title: المعترضات
description: منشئات معترضات HTTP وSSE وWebSocket.
---

# المعترضات

غلّف `next` لوسيلة نقل واحدة. سجّل بـ `withInterceptors`. القوائم المختلطة تُصفّى حسب النوع عند التنفيذ.

## createHttpInterceptor() {#createHttpInterceptor}

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

استدعِ `next(req)` (طلبًا معدَّلًا اختياريًا) أو اختصر المسار بـ `makeResponse`.

## createSSEInterceptor() {#createSSEInterceptor}

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` يمتد `AsyncDisposable`. أي تنفيذ هيكلي للاختصار يجب أن يوفّر `[Symbol.asyncDispose](): PromiseLike<void>` ويربطه بدورة حياة الإغلاق نفسها.

## createWebSocketInterceptor() {#createWebSocketInterceptor}

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

## Interceptor {#Interceptor}

## HttpInterceptor {#HttpInterceptor}

## SSEInterceptor {#SSEInterceptor}

## WebSocketInterceptor {#WebSocketInterceptor}

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

## basicAuthHttpInterceptor() {#basicAuthHttpInterceptor}

## basicAuthSSEInterceptor() {#basicAuthSSEInterceptor}

## BasicAuthInterceptorOptions {#BasicAuthInterceptorOptions}

```ts
function basicAuthHttpInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): HttpInterceptor

function basicAuthSSEInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): SSEInterceptor
```

`fn` تُستدعى لكل طلب. `encode` الاختياري على `BasicAuthInterceptorOptions` يستبدل قيمة رأس `Basic …` الافتراضية.

انظر [دليل المعترضات](/core/interceptors).
