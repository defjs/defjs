---
title: Interceptors
description: HTTP、SSE、WebSocket のインターセプターコンストラクタです。
---

# Interceptors

1 つのトランスポート、または操作呼び出し全体向けに `next` を包みます。`withInterceptors` で登録します。混在したリストは、操作が実行されるときに種類ごとにフィルタされます。

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

ラッパーやショートサーキットのセッションは、`close` / `closed` のライフサイクルと同じ `[Symbol.asyncDispose]()` の破棄処理を委譲する必要があります。無関係な解決済み promise を返すのでは足りません。

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` は呼び出し全体を実行します。入力の検証、エンドポイントの選択、builder、トランスポートインターセプターとリトライを含むすべての試行、レスポンスのデコードです。引数は取らず、何度呼んでも呼び出しは 1 回だけ実行されます。関数は結果についてジェネリックなので、`next()` が解決した値でのみ解決できます。操作インターセプターはすべてのトランスポートに対して、トランスポートインターセプターの外側で実行されます。throw や reject があると操作は `EXT_INTERCEPTOR_FAILED` で解決され、呼び出しがすでに開いていたストリームやセッションは閉じられます。

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## タグ付きの型

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## Basic 認証

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

リクエストごとに `Authorization: Basic <encoded>` を設定します。`fn` は `{ username, password }` を返し、リクエストごとに呼ばれます。省略可能な第 2 引数 `{ encode }` はその認証情報を受け取り、`Basic ` の後ろの部分を返します。デフォルトの符号化は ``btoa(`${username}:${password}`)`` です。`encode` がなく `btoa` が使えない環境では、インターセプターの作成時に throw します。

## 同時実行数制限

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

バケット（`key`、デフォルトは 1 つの共有バケット）ごとに、実行中の HTTP 試行の同時実行数を制限します。`maxConcurrency` を超えたリクエストは、`maxQueue`（デフォルト `Infinity`）まで FIFO 順で待機するか、`BulkheadOverflowError` で reject されます（`{ attempted: false }` 付きの `EXT_INTERCEPTOR_FAILED` として返ります）。パーミットは `withRetry` のバックオフ待機中に解放され、事前または待機中にアボートされたリクエストは `NET_ABORTED` または `NET_TIMEOUT` で解決されます。[同時実行数制限とプールされた呼び出し](/ja-JP/recipes/concurrency-limit) を参照してください。

## 冪等性キー

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

`req.headers` を複製し、`methods`（デフォルト `['POST', 'PATCH']`）に一致するメソッドのリクエストへ `headerName`（デフォルト `'Idempotency-Key'`）を設定します。`respectExisting` が `true`（デフォルト）の場合、すでにそのヘッダーを持つリクエストはスキップします。`generate` を指定しない場合は `req.correlationId` を再利用（または v4 UUID にフォールバック）するため、1 回の呼び出しにおける `withRetry` の各試行で同じキーが送信されます。`generate` を指定した場合は、`req.correlationId` をキーに最大 4,096 エントリの有界キャッシュへメモ化します。[冪等性キー](/ja-JP/recipes/idempotency-key) を参照してください。

[インターセプターガイド](/ja-JP/docs/interceptors) を見てください。
