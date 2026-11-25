---
title: Interceptors
description: HTTP、SSE 與 WebSocket 攔截器的建構函式。
---

# Interceptors

為單一傳輸或整次操作呼叫包住 `next`。以 `withInterceptors` 註冊。混合的清單會在操作執行時依 kind 篩選。

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

呼叫 `next(req)`（可傳入修改過的請求），或以 `makeResponse` 短路。`next` 只向內走：先到這個攔截器之後註冊的攔截器，再到傳輸層。再次呼叫它，會由這個攔截器重跑那段內層流程；外層攔截器不會執行兩次。

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` 擴充了 `AsyncDisposable`。以結構實作短路時，必須提供 `[Symbol.asyncDispose](): PromiseLike<void>`，並接到同一條關閉生命週期。

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` 是攔截器看到的工作階段：

<ApiSignature name="WebSocketSessionLike" />

wrapper 或短路用的工作階段，必須轉發與其 `close`／`closed` 生命週期相同的 `[Symbol.asyncDispose]()` teardown；回傳一個無關的已解析 promise 並不足夠。

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` 會執行整次呼叫：輸入驗證、端點挑選、builder、每次嘗試（連同其傳輸攔截器與重試），以及回應解碼。它不接受引數，不論呼叫幾次都只會執行一次呼叫。這個函式對結果是泛型的，因此只能以 `next()` 解析出的值來解析。操作攔截器對每種傳輸都會執行，位於傳輸攔截器之外。拋出例外或 rejection 會讓操作以 `EXT_INTERCEPTOR_FAILED` 解析，呼叫已開啟的串流或工作階段會被關閉。

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## 帶 kind 的型別

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## 基本認證

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

為每個請求設定 `Authorization: Basic <encoded>`。`fn` 回傳 `{ username, password }`，每個請求呼叫一次。選用的第二個參數 `{ encode }` 會收到這份憑證，並回傳 `Basic ` 之後的部分；預設編碼是 ``btoa(`${username}:${password}`)``。沒有提供 `encode` 時，若 `btoa` 不可用，建立攔截器會拋出例外。

## 並行限制

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

依分桶（`key`，預設為單一共用分桶）限制進行中的 HTTP 嘗試並行數量。超過 `maxConcurrency` 的請求會依 FIFO 順序排隊，上限為 `maxQueue`（預設 `Infinity`），否則以 `BulkheadOverflowError` 拒絕（對外呈現為 `EXT_INTERCEPTOR_FAILED` 且帶有 `{ attempted: false }`）。在 `withRetry` 退避等待期間會釋放許可；預先中止或在排隊中途中止的請求會解析為 `NET_ABORTED` 或 `NET_TIMEOUT`。見[並行限制與池化呼叫](/zh-Hant-TW/recipes/concurrency-limit)。

## 冪等鍵

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

複製 `req.headers`，並在請求方法符合 `methods`（預設 `['POST', 'PATCH']`）時設定 `headerName`（預設 `'Idempotency-Key'`）；當 `respectExisting` 為 `true`（預設）且請求已帶該標頭時略過。未提供 `generate` 時會重用 `req.correlationId`（或退回使用 v4 UUID），讓單次呼叫的每一次 `withRetry` 重試都送出相同的鍵值；提供 `generate` 時，會依 `req.correlationId` 在上限 4,096 筆的快取中記憶結果。見[冪等鍵](/zh-Hant-TW/recipes/idempotency-key)。

見 [Interceptors 指南](/zh-Hant-TW/docs/interceptors)。
