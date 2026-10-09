---
title: 인터셉터
description: HTTP, SSE, WebSocket 인터셉터 생성자예요.
---

# 인터셉터

전송 하나에서 `next`를 감싸요. `withInterceptors`로 등록해요. 혼합 목록은 실행 시점에 kind로 걸러져요.

## createHttpInterceptor() {#createHttpInterceptor}

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

`next(req)`를 호출하거나 (바꾼 요청도 가능) `makeResponse`로 short-circuit해요.

## createSSEInterceptor() {#createSSEInterceptor}

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle`은 `AsyncDisposable`을 상속해요. 구조적인 short-circuit 구현은 `[Symbol.asyncDispose](): PromiseLike<void>`를 제공하고 같은 close lifecycle에 연결해야 해요.

## createWebSocketInterceptor() {#createWebSocketInterceptor}

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike`는 인터셉터가 보는 세션이에요.

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

Wrapper나 short-circuit session은 `close` / `closed` lifecycle과 같은 `[Symbol.asyncDispose]()` teardown을 전달해야 해요. 관계없는 resolved promise를 반환하는 것만으로는 부족해요. 이 멤버 요구는 구조적인 구현에 컴파일 타임 breaking change예요. Defjs가 반환한 session을 받기만 하는 코드는 런타임에 새 호출을 추가할 필요가 없어요.

## 태그가 있는 타입

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

## 기본 인증

## basicAuthHttpInterceptor() {#basicAuthHttpInterceptor}

## basicAuthSSEInterceptor() {#basicAuthSSEInterceptor}

## BasicAuthInterceptorOptions {#BasicAuthInterceptorOptions}

```ts
function basicAuthHttpInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): HttpInterceptor

function basicAuthSSEInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): SSEInterceptor
```

`fn`은 요청마다 호출돼요. `BasicAuthInterceptorOptions`의 선택 `encode`가 기본 `Basic …` 헤더 값을 교체해요.

[인터셉터 가이드](/core/interceptors)를 보세요.
