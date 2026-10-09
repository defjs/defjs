---
title: API Reference
description: 手寫嘅 workspace package lookup — 你 import 嗰啲 functions、options 同 types。
---

# API Reference

呢度係 workspace packages 嘅 lookup。Signatures 就係 contract；guides 同 recipes 先講幾時用。

## Packages

| Package                                                    | 你嚟查咩                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| Page                              | 你嚟查咩                                                         |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | `Fault` variants 同 factories                                    |
| [Interceptors](./interceptors.md) | HTTP / SSE / WebSocket interceptor helpers                       |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## Related

- [Getting Started](/guide/getting-started)
- [GET with a declared 404](/recipes/get-declared-404)
