---
title: مرجع API
description: مرجع مكتوب يدويًا لحزم مساحة العمل — الدوال والخيارات والأنواع التي تستوردها.
---

# مرجع API

هذا مرجع البحث لحزم مساحة العمل. التوقيعات هي العقد؛ الأدلّة والوصفات تشرح متى تستخدمها.

## الحزم

| الحزمة                                                     | ما تبحث عنه                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| الصفحة                            | ما تبحث عنه                                                      |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | تنويعات `Fault` ومصانعها                                         |
| [Interceptors](./interceptors.md) | مساعدات interceptor لـ HTTP / SSE / WebSocket                    |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## ذات صلة

- [البدء](/guide/getting-started)
- [GET مع 404 معلَن](/recipes/get-declared-404)
