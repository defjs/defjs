---
title: API 레퍼런스
description: 워크스페이스 패키지 조회예요. import하는 함수, 옵션, 타입이에요.
---

# API 레퍼런스

워크스페이스 패키지 조회예요. 시그니처가 계약이에요. 가이드와 레시피는 언제 쓸지 설명해요.

## 패키지

| 패키지                                                     | 여기서 찾는 것                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| 페이지                            | 여기서 찾는 것                                                   |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | `Fault` 종류와 팩토리                                            |
| [Interceptors](./interceptors.md) | HTTP / SSE / WebSocket interceptor 헬퍼                          |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## 관련

- [시작하기](/guide/getting-started)
- [선언된 404가 있는 GET](/recipes/get-declared-404)
