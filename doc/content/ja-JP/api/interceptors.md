---
title: Interceptors
description: HTTP、SSE、WebSocket のインターセプターコンストラクタです。
---

# Interceptors

1 つのトランスポート向けに `next` を包みます。`withInterceptors` で登録します。混在リストは execute 時に kind でフィルタされます。

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

`next(req)` を呼びます（ミューテートしたリクエストでも可）。または `makeResponse` でショートサーキットします。`next` は内側にしか進みません。このインターセプターより後に登録されたインターセプター、そしてトランスポートへ進みます。もう一度呼ぶと、このインターセプターからその内側の部分を再実行します。外側のインターセプターが 2 回実行されることはありません。

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` は `AsyncDisposable` を拡張します。構造的なショートサーキット実装は `[Symbol.asyncDispose](): PromiseLike<void>` を提供し、同じ close ライフサイクルへ繋ぐ必要があります。

## createWebSocketInterceptor()

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` はインターセプターから見たセッションです。

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

wrapper やショートサーキットのセッションは、`close` / `closed` のライフサイクルと同じ `[Symbol.asyncDispose]()` の teardown を転送する必要があります。無関係な解決済み promise を返すのでは足りません。このメンバーを要求することは、構造的実装にとってはコンパイル時の破壊的変更です。Defjs が返すセッションだけを受け取るコードには、追加の実行時呼び出しは要りません。

## タグ付きの型

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

## Basic 認証

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

リクエストごとに `Authorization: Basic <encoded>` をセットします。`fn` はリクエストごとに呼ばれます。`encode` は `Basic ` の後ろの部分を返します。デフォルトは `btoa('username:password')` です。`encode` がなく `btoa` が使えない環境では、インターセプターの作成時に throw します。

[Interceptors ガイド](/ja-JP/docs/interceptors) を見てください。
