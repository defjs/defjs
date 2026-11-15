---
title: 拦截器
description: HTTP、SSE 与 WebSocket 拦截器构造函数。
---

# 拦截器

为单一传输或整次操作调用包装 `next`。通过 `withInterceptors` 注册。混合列表在操作运行时按类型过滤。

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

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` 运行整次调用：输入校验、端点选择、builder、每次尝试（含其传输拦截器与重试）以及响应解码。它不接收参数，无论调用多少次都只运行一次调用。该函数对结果是泛型的，因此只能以 `next()` resolve 的值来 resolve。操作拦截器对每种传输都会运行，位于传输拦截器之外。抛出或 reject 会让操作以 `EXT_INTERCEPTOR_FAILED` resolve，调用已打开的流或会话会被关闭。

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## 带标签的类型

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## 基本认证

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

在每个请求上设置 `Authorization: Basic <encoded>`。`fn` 返回 `{ username, password }`，每个请求调用一次。可选的第二个参数 `{ encode }` 接收该凭据，并返回 `Basic ` 之后的部分；默认编码是 ``btoa(`${username}:${password}`)``。不传 `encode` 时，如果 `btoa` 不可用，创建拦截器会抛错。

见 [拦截器指南](/zh-Hans/docs/interceptors)。
