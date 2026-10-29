---
title: 拦截器
description: HTTP、SSE、WebSocket interceptor 构造函数。
---

# 拦截器

为某一种传输包装 `next`。用 `withInterceptors` 注册。混着的列表在 execute 时按 kind 过滤。

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

调 `next(req)`（可以先改 request）或用 `makeResponse` 短路。`next` 只向内走：交给在此 interceptor 之后注册的 interceptor，然后是传输。再次调用它，会从本 interceptor 起重放这段内层；外层 interceptor 不会运行两次。

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` 扩展了 `AsyncDisposable`。结构化短路实现必须提供 `[Symbol.asyncDispose](): PromiseLike<void>`，并连接到同一条 close lifecycle。

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` 是 interceptor 看到的 session：

<ApiSignature name="WebSocketSessionLike" />

Wrapper 或短路 session 必须转发与其 `close` / `closed` lifecycle 相同的 `[Symbol.asyncDispose]()` teardown；返回无关的 resolved promise 并不够。要求这个成员对结构化实现而言是编译期 breaking change。只接收 Defjs session 的代码无需新增运行时调用。

## 带标签的类型

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## 基本认证

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

在每个请求上设置 `Authorization: Basic <encoded>`。`fn` 返回 `{ username, password }`，每个请求调一次。可选的第二个参数 `{ encode }` 收到这份凭据，并返回 `Basic ` 之后的那一部分；默认编码是 ``btoa(`${username}:${password}`)``。不传 `encode` 时，如果 `btoa` 不可用，创建 interceptor 会抛错。

见 [拦截器指南](/zh-Hans/docs/interceptors)。
