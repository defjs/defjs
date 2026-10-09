---
title: Справка API
description: Ручной lookup пакетов воркспейса — функции, опции и типы, которые импортируешь.
---

# Справка API

Это lookup по пакетам воркспейса. Сигнатуры — контракт; гайды и рецепты говорят, когда это брать.

## Пакеты

| Пакет                                                      | Что ищешь                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| Страница                          | Что ищешь                                                        |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | варианты и фабрики `Fault`                                       |
| [Interceptors](./interceptors.md) | хелперы interceptor HTTP / SSE / WebSocket                       |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## Связанное

- [Начало работы](/guide/getting-started)
- [GET с объявленным 404](/recipes/get-declared-404)
