---
title: "指南"
description: 设计 SDK 契约与操作，独立打包发布，并在消费方应用中自由配置与执行。
---

Defjs 将 SDK 团队发布的 API 契约与消费方应用在运行时配置的 Client 彻底分离开来。阅读以下各章节，围绕“声明契约”与“管控执行”两条主线，学习如何定义操作，并通过 Client 选项和中间件拦截器全面治理执行行为。

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
- [中间件拦截器](/zh-Hans/docs/interceptors)
- [负载均衡与故障转移](/zh-Hans/docs/load-balancing)
- [测试](/zh-Hans/docs/testing)

## 框架集成与 AI [#integrations-and-ai]

- [开发插件](/zh-Hans/docs/integrations)
- [React](/zh-Hans/docs/integrations/react)
- [Vue](/zh-Hans/docs/integrations/vue)
- [OpenTelemetry 服务端](/zh-Hans/docs/integrations/opentelemetry-server)
- [Skill](/zh-Hans/docs/ai)
- [llms.txt](/zh-Hans/docs/ai-api)
