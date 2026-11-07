---
title: 拦截器
description: HTTP、SSE 与 WebSocket 拦截器构造函数。
---

# 拦截器

为单一传输包装 `next`。通过 `withInterceptors` 注册。混合列表在操作运行时按类型过滤。

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

调用 `next(req)`（可传入修改后的请求）或用 `makeResponse` 短路。`next` 只向内：先交给此后注册的拦截器，再到传输层。再次调用它会从本拦截器起重放这段内层；外层拦截器不会运行两次。

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` 扩展 `AsyncDisposable`。结构化短路实现必须提供 `[Symbol.asyncDispose](): PromiseLike<void>`，并连接到同一个关闭生命周期。

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` 是拦截器看到的会话：

<ApiSignature name="WebSocketSessionLike" />

包装器或短路会话必须转发与自身 `close` / `closed` 生命周期相同的 `[Symbol.asyncDispose]()` 清理逻辑；返回一个无关的已 resolve promise 不够。

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

在每个请求上设置 `Authorization: Basic <encoded>`。`fn` 返回 `{ username, password }`，每个请求调用一次。可选的第二个参数 `{ encode }` 接收该凭据，并返回 `Basic ` 之后的部分；默认编码是 ``btoa(`${username}:${password}`)``。不传 `encode` 时，如果 `btoa` 不可用，创建拦截器会抛错。

见 [拦截器指南](/zh-Hans/docs/interceptors)。
