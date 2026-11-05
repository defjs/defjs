---
title: "指南"
description: 设计 SDK 契约与操作、发布它们，并在消费方应用里配置执行。
---

Defjs 把团队发布的 API 和应用使用的 client 分开。这组指南围绕两条路径：沿 SDK 编写路径定义并打包操作；沿应用路径配置执行并处理结果。

## 前言 [#getting-started]

- [项目概览](/zh-Hans)
- [快速开始](/zh-Hans/docs/start)
- [构建并发布 SDK](/zh-Hans/recipes/publish-http-sdk)
- [为何定义与执行彼此独立](/zh-Hans/docs/design-decisions)

## 核心概念 [#core-concepts]

- [数据结构 / Struct](/zh-Hans/docs/struct)
- [Client](/zh-Hans/docs/client)
- [中间件](/zh-Hans/docs/interceptors)
- [错误](/zh-Hans/docs/errors)

## 请求与实时通信

- [HTTP 请求](/zh-Hans/docs/http)
- [SSE 事件流](/zh-Hans/docs/sse)
- [WebSocket 会话](/zh-Hans/docs/web-socket)

## 插件

给消费方应用的 client 用的可选包。SDK 定义与它们保持独立。

- [插件](/zh-Hans/docs/integrations)
- [React](/zh-Hans/docs/integrations/react)
- [Vue](/zh-Hans/docs/integrations/vue)
- [OpenTelemetry 服务端](/zh-Hans/docs/integrations/opentelemetry-server)

## AI

- [AI 辅助开发](/zh-Hans/docs/ai)
- [调用 AI API](/zh-Hans/docs/ai-api)

[设计决策](/zh-Hans/docs/design-decisions)
