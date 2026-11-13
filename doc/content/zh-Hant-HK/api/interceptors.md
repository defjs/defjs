---
title: Interceptors
description: HTTP、SSE 同 WebSocket 攔截器建構函式。
---

# Interceptors

為單一傳輸層包裝 `next`。用 `withInterceptors` 註冊。混合清單會喺操作執行時按種類過濾。

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

## 帶標記嘅型別

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## 基本認證

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

每個 request 都會設定 `Authorization: Basic <encoded>`。`fn` 回傳 `{ username, password }`，每個 request 呼叫一次。可選嘅第二個參數 `{ encode }` 會收到呢份 credential，並回傳 `Basic ` 之後嗰部分；預設編碼係 ``btoa(`${username}:${password}`)``。冇提供 `encode` 時，如果 `btoa` 唔可用，建立攔截器會 throw。

睇[攔截器指南](/zh-Hant-HK/docs/interceptors)。
