---
title: Interceptors
description: HTTP、SSE 同 WebSocket 攔截器建構函式。
---

# Interceptors

為單一傳輸層，或者為整個操作呼叫包裝 `next`。用 `withInterceptors` 註冊。混合清單會喺操作執行時按種類過濾。

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

呼叫 `next(req)`（可以傳入改過嘅 request），或者用 `makeResponse` 短路。`next` 只會向內走：先到喺呢個攔截器之後註冊嘅攔截器，再到傳輸層。再呼叫一次，會由呢個攔截器重新執行內層嗰部分；外層攔截器唔會執行兩次。

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` 繼承 `AsyncDisposable`。結構式嘅短路實作必須提供 `[Symbol.asyncDispose](): PromiseLike<void>`，並將佢接去同一條關閉生命週期。

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` 係攔截器見到嘅會話：

<ApiSignature name="WebSocketSessionLike" />

Wrapper 或者短路會話必須轉發同 `close` / `closed` 生命週期一致嘅 `[Symbol.asyncDispose]()` teardown；回傳一個無關嘅已 resolve promise 並唔足夠。

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` 會執行成個呼叫：input 驗證、端點揀選、builder、每次嘗試連同其傳輸攔截器同重試，以及 response 解碼。佢唔接受參數，無論呼叫幾多次，都只會執行一次呼叫。呢個函式對結果係泛型，所以只可以用 `next()` resolve 嘅結果去 resolve。操作攔截器對每種傳輸層都會執行，並且喺傳輸攔截器外面。throw 或者 rejection 會令操作以 `EXT_INTERCEPTOR_FAILED` 結算，呼叫已經開啟嘅串流或者會話會被關閉。

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## 帶標記嘅型別

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

每個 request 都會設定 `Authorization: Basic <encoded>`。`fn` 回傳 `{ username, password }`，每個 request 呼叫一次。可選嘅第二個參數 `{ encode }` 會收到呢份 credential，並回傳 `Basic ` 之後嗰部分；預設編碼係 ``btoa(`${username}:${password}`)``。冇提供 `encode` 時，如果 `btoa` 唔可用，建立攔截器會 throw。

## 並發限制

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

按 bucket（`key`，預設為單一共用 bucket）限制並發進行中嘅 HTTP 嘗試次數。超出 `maxConcurrency` 嘅請求會按 FIFO 順序排隊，上限為 `maxQueue`（預設 `Infinity`），或者以 `BulkheadOverflowError` reject（以 `EXT_INTERCEPTOR_FAILED` 連同 `{ attempted: false }` 浮現）。許可（permit）會喺 `withRetry` 退避等待期間釋放，而預先中止或者排隊期間中止嘅請求會以 `NET_ABORTED` 或 `NET_TIMEOUT` 結算。睇[並發限制與池化呼叫](/zh-Hant-HK/recipes/concurrency-limit)。

## 冪等鍵

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

複製 `req.headers`，並對符合 `methods`（預設 `['POST', 'PATCH']`）嘅請求設定 `headerName`（預設 `'Idempotency-Key'`）；當 `respectExisting` 為 `true`（預設）時，會跳過已經帶有該 header 嘅請求。冇提供 `generate` 時，會重用 `req.correlationId`（或退回 v4 UUID），令單次呼叫每次 `withRetry` 嘗試都送出相同嘅 key；提供 `generate` 時，會按 `req.correlationId` 記憶於上限 4,096 項嘅有界快取中。睇[冪等鍵](/zh-Hant-HK/recipes/idempotency-key)。

睇[攔截器指南](/zh-Hant-HK/docs/interceptors)。
