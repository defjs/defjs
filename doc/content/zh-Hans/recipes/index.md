---
title: "操作示例"
description: 构建并发布可复用的 SDK，并在消费方应用中自由配置认证、请求调用和实时通信。
---

建议首先阅读[构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk)，了解从导出 SDK 契约定义到打包为 npm 依赖并在应用中消费的完整流程。通过以下实战示例，你可以充分掌握如何围绕这套 SDK 组合出具体的接口契约与应用控制策略，示例均采用多文件选项卡直观呈现定义与执行的协同方式。

## HTTP

- [发送 JSON](/zh-Hans/recipes/post-json) —— 将代码中的驼峰字段（camelCase）映射到底层网络传输的下划线字段（`snake_case`），并校验解码强类型的 `201` 响应。
- [处理声明的 404](/zh-Hans/recipes/get-declared-404) —— 区分业务成功时的类型化 `200` 数据，与显式声明了结构体的 `404` `HTTP_STATUS` 错误体。
- [取消与超时](/zh-Hans/recipes/cancel-http) —— 结合调用方传入的 `AbortController` 与 `AbortSignal.timeout(...)`，并在错误处理中准确区分 `NET_ABORTED` 和 `NET_TIMEOUT`。
- [ETag 条件请求](/zh-Hans/recipes/etag-revalidate) —— 自动携带 `If-None-Match`，将 `304 Not Modified` 作为预期的 `HTTP_STATUS` 错误捕获，并在应用内存中维护缓存 `Map`。
- [GraphQL 请求](/zh-Hans/recipes/graphql-http-envelope) —— 通过 HTTP `POST` 发送 GraphQL 查询，并在应用层辅助函数中安全解包 `errors[]` 与 `.nullish()` 的 `data` 载荷。

## 身份认证

- [401 后刷新令牌](/zh-Hans/recipes/refresh-bearer-once) —— 携带 `Bearer` 令牌，在单个 HTTP 拦截器中合并并发的刷新请求，并在换票成功后自动重试一次原请求。

## 实时通信

- [消费 SSE 事件流](/zh-Hans/recipes/consume-sse) —— 打开强类型的 Server-Sent Events 流，通过 `for await` 单次遍历事件，并在 `finally` 中严格保证 `stream.close()` 与 `await stream.closed`。
- [管理 WebSocket 会话](/zh-Hans/recipes/websocket-session) —— 双向收发类型化的 JSON 数据帧，监听 `onRuntimeError` 运行时事件，并在完成时优雅断开连接。

## SDK 测试与发布 [#testing-and-packaging]

- [本地 HTTP 测试](/zh-Hans/recipes/test-with-handle) —— 利用 `withHTTPHandle(...)` 在纯内存中完整测试 URL 拼接、中间件拦截链以及 Struct 数据的编码与解码。
- [构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk) —— 使用 `tsdown` 打包零 Client 绑定的纯净 SDK，发布到 npm，并在消费方应用中安全导入。
