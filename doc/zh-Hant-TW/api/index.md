---
title: API 查閱
description: 手寫的工作區套件查表 — 你會 import 的函式、options 與型別。
---

# API 查閱

這是工作區套件的查表頁。簽章就是契約；指南跟 recipes 講何時該用。

## 套件

| 套件                                                       | 你要查的                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| 頁面                              | 你要查的                                                         |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | `Fault` 幾種和工廠函式                                           |
| [Interceptors](./interceptors.md) | HTTP／SSE／WebSocket 的 interceptor helpers                      |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## 相關

- [開始使用](/guide/getting-started)
- [已宣告 404 的 GET](/recipes/get-declared-404)
