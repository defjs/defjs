---
title: Interceptors
description: HTTP、SSE 同 WebSocket interceptor constructors。
---

# Interceptors

為一個 transport wrap `next`。用 `withInterceptors` register。Mixed lists 會喺 execute 時按 kind filter。

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Call `next(req)`（可以傳已 mutate 嘅 request），或者用 `makeResponse` short-circuit。`next` 只會向內走：先去喺呢個 interceptor 之後註冊嘅 interceptors，再去 transport。再 call 一次，會由呢個 interceptor 重新行一次內層嗰部分；外層 interceptors 唔會運行兩次。

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` extend 咗 `AsyncDisposable`。Structural short-circuit implementation 必須 provide `[Symbol.asyncDispose](): PromiseLike<void>`，再接去同一條 close lifecycle。

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` 係 interceptor 見到嘅 session：

<ApiSignature name="WebSocketSessionLike" />

Wrapper 或 short-circuit session 必須 forward 同佢 `close` / `closed` lifecycle 一樣嘅 `[Symbol.asyncDispose]()` teardown；return 一個無關嘅 resolved promise 並唔夠。要求呢個 member，對 structural implementation 嚟講係 compile-time breaking change。淨係接收 Defjs session 嘅 code 唔使加新 runtime call。

## 帶 kind 嘅類型

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

每個 request 設定 `Authorization: Basic <encoded>`。`fn` 回傳 `{ username, password }`，每個 request call 一次。可選嘅第二個參數 `{ encode }` 收到呢份 credential，並回傳 `Basic ` 後面嗰部分；default 編碼係 ``btoa(`${username}:${password}`)``。唔傳 `encode` 時，如果 `btoa` 唔可用，建立 interceptor 會 throw。

睇 [Interceptors guide](/zh-Hant-HK/docs/interceptors)。
