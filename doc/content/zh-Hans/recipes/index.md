---
title: "操作示例"
description: 构建并发布可复用的 SDK，再在消费方应用里配置鉴权、调用和实时工作。
---

先从[构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk)看起，它覆盖从导出定义到 npm 包和消费方应用的整条路径。下面的示例让你掌握可以围绕这份 SDK 组合的单项操作契约和应用策略。

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

## SDK 测试与发布 [#testing-and-packaging]

- [本地 HTTP 测试](/zh-Hans/recipes/test-with-handle)
- [构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk)
