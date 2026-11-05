---
title: "总览"
description: "让 SDK 在作者、应用和不同运行时之间保持可预测的契约与边界。"
---

这些实践不是 Defjs 运行所必需。当定义、应用和传输由不同的人负责时，它们让 SDK 保持可预测。每页从一条规则开始，给出推荐与避免的写法，并解释背后的边界。

## 定义与执行分离 [#definition-execution]

定义是数据。它声明 method、path、input、output 和错误契约，不创建 client、不读取凭证、不发起 I/O。应用创建 client 并调用操作；调用操作才开始请求。

这样 SDK 包可以不携带 endpoint 和凭证，同一份定义也能在浏览器、服务端或测试中用不同 endpoint 运行。

## 声明 input，显式放置 [#input-builder]

`input` 描述调用方提供的值。`builder` 决定每个值放到 path、query、headers 还是 body。放置方式不会根据字段名或 path 模板推断。

`builder` 是同步纯函数，在执行时运行。抛出会变成 `REQ_BUILD_FAILED`。

## 先读错误槽 [#error-first]

每个操作返回 error-first tuple。第一个元素是 fault 或 `null`。请求、响应和传输失败不会在调用点抛出。

先读 fault，再使用成功值。按 `code` 收窄，然后读取该 fault 的字段。

## 应用拥有 client [#client-ownership]

应用拥有 endpoint、凭证、interceptor、传输，以及流和会话的生命周期。SDK 拥有契约。插件可以把应用 client 传过框架树，但不创建或缓存 client。

## 本节页面 [#pages]

- [SDK 设计](/zh-Hans/docs/best-practices/sdk-design) — 定义、Struct、命名与发布。
- [应用集成](/zh-Hans/docs/best-practices/application) — client 创建、配置、interceptor 与框架插件。
- [错误处理](/zh-Hans/docs/best-practices/errors) — fault code、收窄、日志与重试。
- [流式与实时](/zh-Hans/docs/best-practices/streaming) — SSE、WebSocket、所有权与背压。
- [测试](/zh-Hans/docs/best-practices/testing) — 注入传输、契约测试与时间控制。
- [安全](/zh-Hans/docs/best-practices/security) — 凭证、XSRF、URL 校验与脱敏。
- [性能](/zh-Hans/docs/best-practices/performance) — 流式传输、队列、failover 与测量。
