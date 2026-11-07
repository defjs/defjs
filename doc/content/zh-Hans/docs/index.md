---
title: "指南"
description: 设计并发布 SDK 契约与操作，并在消费方应用中配置执行方式。
---

Defjs 将 SDK 团队发布的 API 契约与消费方应用在运行时使用的 Client 配置分离开来。阅读以下各章节，了解整体架构、定义操作，并通过 Client 选项和拦截器管控执行。

## 快速起步 [#getting-started]

- [项目概览](/zh-Hans)
- [快速开始](/zh-Hans/docs/start)
- [核心架构设计](/zh-Hans/docs/design-decisions)

## 定义 SDK [#defining-sdks]

- [数据结构 / Struct](/zh-Hans/docs/struct)
- [HTTP 请求](/zh-Hans/docs/http)
- [SSE 事件流](/zh-Hans/docs/sse)
- [WebSocket 会话](/zh-Hans/docs/web-socket)

## Client 与执行 [#client-execution]

- [Client](/zh-Hans/docs/client)
- [错误处理](/zh-Hans/docs/errors)
- [拦截器](/zh-Hans/docs/interceptors)
- [负载均衡与故障转移](/zh-Hans/docs/load-balancing)
- [测试](/zh-Hans/docs/testing)

## 框架集成与 AI [#integrations-and-ai]

- [集成概览](/zh-Hans/docs/integrations)
- [React](/zh-Hans/docs/integrations/react)
- [Vue](/zh-Hans/docs/integrations/vue)
- [OpenTelemetry 服务端](/zh-Hans/docs/integrations/opentelemetry-server)
- [Skill](/zh-Hans/docs/ai)
- [llms.txt](/zh-Hans/docs/ai-api)
