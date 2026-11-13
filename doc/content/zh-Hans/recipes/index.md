---
title: "操作示例"
description: 构建并发布可复用的 SDK，然后在消费方应用中配置认证、调用和实时通信。
---

# 操作示例

从[构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk)开始，了解从导出 SDK 定义到打包为 npm 包并在应用中使用的完整流程。以下每个配方都把一份操作契约与围绕它的应用策略配对，并用多文件代码选项卡展示 SDK 定义与应用执行模块如何协作。

## HTTP

- [发送 JSON](/zh-Hans/recipes/post-json) —— 把逻辑上的 camelCase 字段映射到网络 `snake_case` 键，并解码带类型的 `201` 响应。
- [处理声明的 404](/zh-Hans/recipes/get-declared-404) —— 在带类型的 `200` 输出与声明的 `404` `HTTP_STATUS` 错误体之间分支。
- [取消与超时](/zh-Hans/recipes/cancel-http) —— 把调用方 `AbortController` 与 `AbortSignal.timeout(...)` 组合起来，并区分 `NET_ABORTED` 与 `NET_TIMEOUT`。
- [ETag 条件请求](/zh-Hans/recipes/etag-revalidate) —— 发送 `If-None-Match`，把 `304 Not Modified` 当作 `HTTP_STATUS` Fault 处理，并把缓存 `Map` 留在应用代码中。
- [GraphQL 请求](/zh-Hans/recipes/graphql-http-envelope) —— 通过 HTTP `POST` 发送 GraphQL 查询，并在应用辅助函数中解包 `errors[]` 与 `.nullish()` 的 `data`。

## 身份认证

- [401 后刷新令牌](/zh-Hans/recipes/refresh-bearer-once) —— 附加 `Bearer` 令牌，合并并发刷新，并在单个 HTTP 拦截器中重放一次。

## 实时通信

- [消费 SSE 事件](/zh-Hans/recipes/consume-sse) —— 打开带类型的 Server-Sent Events 流，迭代一次，并在 `finally` 中保证执行 `stream.close()` + `await stream.closed`。
- [管理 WebSocket 会话](/zh-Hans/recipes/websocket-session) —— 收发带类型的入站/出站 JSON 帧，订阅 `onRuntimeError`，并干净地关闭。

## SDK 测试与发布 [#testing-and-packaging]

- [本地 HTTP 测试](/zh-Hans/recipes/test-with-handle) —— 用 `withHTTPHandle(...)` 在内存中测试 URL 构建、拦截器和 struct 解码。
- [构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk) —— 用 `tsdown` 打包并发布不绑定 Client 的 SDK，并在应用中使用。
