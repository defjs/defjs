---
title: Interceptors
description: HTTP、SSE、WebSocket のインターセプターコンストラクタです。
---

# Interceptors

1 つのトランスポート向けに `next` を包みます。`withInterceptors` で登録します。混在リストは execute 時に kind でフィルタされます。

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

`next(req)` を呼びます（ミューテートしたリクエストでも可）。または `makeResponse` でショートサーキットします。`next` は内側にしか進みません。このインターセプターより後に登録されたインターセプター、そしてトランスポートへ進みます。もう一度呼ぶと、このインターセプターからその内側の部分を再実行します。外側のインターセプターが 2 回実行されることはありません。

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` は `AsyncDisposable` を拡張します。構造的なショートサーキット実装は `[Symbol.asyncDispose](): PromiseLike<void>` を提供し、同じ close ライフサイクルへ繋ぐ必要があります。

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` はインターセプターから見たセッションです。

<ApiSignature name="WebSocketSessionLike" />

wrapper やショートサーキットのセッションは、`close` / `closed` のライフサイクルと同じ `[Symbol.asyncDispose]()` の teardown を転送する必要があります。無関係な解決済み promise を返すのでは足りません。このメンバーを要求することは、構造的実装にとってはコンパイル時の破壊的変更です。Defjs が返すセッションだけを受け取るコードには、追加の実行時呼び出しは要りません。

## タグ付きの型

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## Basic 認証

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

リクエストごとに `Authorization: Basic <encoded>` をセットします。`fn` は `{ username, password }` を返し、リクエストごとに呼ばれます。省略可能な第 2 引数 `{ encode }` はその credential を受け取り、`Basic ` の後ろの部分を返します。デフォルトの符号化は ``btoa(`${username}:${password}`)`` です。`encode` がなく `btoa` が使えない環境では、インターセプターの作成時に throw します。

[Interceptors ガイド](/ja-JP/docs/interceptors) を見てください。
