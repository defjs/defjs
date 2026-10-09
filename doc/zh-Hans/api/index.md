---
title: API 参考
description: 手写的工作区包查阅页——你 import 的函数、options 和类型。
---

# API 参考

这是工作区包的查阅页。签名是契约；指南和配方告诉你什么时候用。

## 包

| 包                                                         | 你来查什么                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`、`defineRequest`、`struct`、HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`、`injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`、`useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| 页面                              | 你来查什么                                                       |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | `Fault` 几种和工厂                                               |
| [Interceptors](./interceptors.md) | HTTP / SSE / WebSocket 的 interceptor helpers                    |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## 相关

- [快速开始](/guide/getting-started)
- [声明了 404 的 GET](/recipes/get-declared-404)
