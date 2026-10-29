---
title: "操作示例"
description: 定义、测试和发布 SDK，并在应用中处理 HTTP、鉴权和实时通信的完整示例。
---

这些示例覆盖 SDK 的定义、测试和发布，也展示应用如何配置 Client、处理结果和管理资源。先掌握[定义与执行](/zh-Hans/docs/commands)，再按任务选用；准备跨项目复用时，直接看[构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk)。

## HTTP

- [发送 JSON](/zh-Hans/recipes/post-json)
- [处理声明的 404](/zh-Hans/recipes/get-declared-404)
- [取消与超时](/zh-Hans/recipes/cancel-http)
- [ETag 条件请求](/zh-Hans/recipes/etag-revalidate)
- [GraphQL 请求](/zh-Hans/recipes/graphql-http-envelope)

## 认证

- [401 后刷新令牌](/zh-Hans/recipes/refresh-bearer-once)

## 实时通信

- [消费 SSE 事件流](/zh-Hans/recipes/consume-sse)
- [管理 WebSocket 会话](/zh-Hans/recipes/websocket-session)

## SDK 测试与发布 [#测试与封装]

- [本地 HTTP 测试](/zh-Hans/recipes/test-with-handle)
- [构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk)
