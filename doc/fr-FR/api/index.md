---
title: Référence API
description: Référence manuscrite des paquets du workspace — fonctions, options et types que tu importes.
---

# Référence API

C’est la référence des paquets du workspace. Les signatures sont le contrat ; les guides et les recettes expliquent quand les utiliser.

## Paquets

| Paquet                                                     | Ce que tu cherches                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| Page                              | Ce que tu cherches                                               |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | variantes et fabriques de `Fault`                                |
| [Interceptors](./interceptors.md) | helpers d’interceptor HTTP / SSE / WebSocket                     |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## Voir aussi

- [Bien démarrer](/guide/getting-started)
- [GET avec un 404 déclaré](/recipes/get-declared-404)
