---
title: 인터셉터
description: HTTP, SSE, WebSocket 인터셉터 생성자예요.
---

# 인터셉터

전송 하나에서 `next`를 감싸요. `withInterceptors`로 등록해요. 혼합 목록은 실행 시점에 kind로 걸러져요.

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

`next(req)`를 호출하거나 (바꾼 요청도 가능) `makeResponse`로 short-circuit해요. `next`는 안쪽으로만 진행해요. 이 interceptor 뒤에 등록된 interceptor들을 거쳐 전송까지 가요. 다시 호출하면 그 안쪽 부분을 이 interceptor부터 다시 실행하고, 바깥쪽 interceptor는 두 번 실행되지 않아요.

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle`은 `AsyncDisposable`을 상속해요. 구조적인 short-circuit 구현은 `[Symbol.asyncDispose](): PromiseLike<void>`를 제공하고 같은 close lifecycle에 연결해야 해요.

## createWebSocketInterceptor()

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

## 기본 인증

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

요청마다 `Authorization: Basic <encoded>`를 설정해요. `fn`은 요청마다 호출돼요. `encode`는 `Basic ` 뒤에 올 부분을 돌려주고, 기본값은 `btoa('username:password')`예요. `encode`가 없을 때 `btoa`를 쓸 수 없으면 interceptor를 만드는 시점에 throw해요.

[인터셉터 가이드](/ko-KR/docs/interceptors)를 보세요.
