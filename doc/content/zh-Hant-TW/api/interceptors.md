---
title: Interceptors
description: HTTP、SSE、WebSocket interceptor 的 constructors。
---

# Interceptors

針對一種傳輸包住 `next`。用 `withInterceptors` 註冊。混合清單在執行時依 kind 篩選。

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

呼叫 `next(req)`（可以是改過的 request），或用 `makeResponse` 短接。`next` 只往內走：先到在這個 interceptor 之後註冊的 interceptors，再到傳輸層。再次呼叫它，會從這個 interceptor 起重新執行那段內層流程；外層的 interceptors 不會執行兩次。

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` 擴充了 `AsyncDisposable`。結構化短接實作必須提供 `[Symbol.asyncDispose](): PromiseLike<void>`，並接到同一條 close lifecycle。

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` 是 interceptor 看到的 session：

<ApiSignature name="WebSocketSessionLike" />

Wrapper 或短接 session 必須轉發與其 `close` / `closed` lifecycle 相同的 `[Symbol.asyncDispose]()` teardown；回傳無關的 resolved promise 並不足夠。要求這個成員，對結構化實作而言是編譯期 breaking change。只接收 Defjs session 的程式碼不必新增執行期呼叫。

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

在每個 request 上設定 `Authorization: Basic <encoded>`。`fn` 回傳 `{ username, password }`，每個 request 呼叫一次。選填的第二個參數 `{ encode }` 收到這份憑證，並回傳 `Basic ` 之後的那一部分；預設編碼是 ``btoa(`${username}:${password}`)``。不傳 `encode` 時，如果 `btoa` 不可用，建立 interceptor 會丟錯。

見 [Interceptors 指南](/zh-Hant-TW/docs/interceptors)。
