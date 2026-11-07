---
title: Interceptors
description: HTTP、SSE 與 WebSocket 攔截器的建構函式。
---

# Interceptors

為單一傳輸包住 `next`。以 `withInterceptors` 註冊。混合的清單會在操作執行時依 kind 篩選。

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

## 帶 kind 的型別

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

為每個請求設定 `Authorization: Basic <encoded>`。`fn` 回傳 `{ username, password }`，每個請求呼叫一次。選用的第二個參數 `{ encode }` 會收到這份憑證，並回傳 `Basic ` 之後的部分；預設編碼是 ``btoa(`${username}:${password}`)``。沒有提供 `encode` 時，若 `btoa` 不可用，建立攔截器會拋出例外。

見 [Interceptors 指南](/zh-Hant-TW/docs/interceptors)。
