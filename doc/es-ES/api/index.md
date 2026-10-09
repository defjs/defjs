---
title: Referencia de API
description: Consulta manuscrita de los paquetes del workspace — funciones, opciones y tipos que importas.
---

# Referencia de API

Aquí consultas los paquetes del workspace. Las firmas son el contrato; las guías y recetas explican cuándo usarlas.

## Paquetes

| Paquete                                                    | Qué consultas                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| Página                            | Qué consultas                                                        |
| --------------------------------- | -------------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, opciones `with*`, `Client`                           |
| [HTTP](./http.md)                 | `defineRequest`, opciones de execute, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                                   |
| [Errors](./errors.md)             | variantes y factorías de `Fault`                                     |
| [Interceptors](./interceptors.md) | helpers de interceptor HTTP / SSE / WebSocket                        |
| [SSE](./sse.md)                   | `defineEventStream`, handle del stream                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, sesión                                            |

## Relacionado

- [Primeros pasos](/guide/getting-started)
- [GET con un 404 declarado](/recipes/get-declared-404)
