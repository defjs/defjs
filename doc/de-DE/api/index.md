---
title: API-Referenz
description: Handgeschriebene Lookup-Seiten für Workspace-Pakete — Functions, Options und Types, die du importierst.
---

# API-Referenz

Hier schlägst du Workspace-Pakete nach. Signatures sind der Vertrag; Guides und Rezepte erklären, wann du sie nutzt.

## Pakete

| Paket                                                      | Was du nachschlägst                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| Seite                             | Was du nachschlägst                                              |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | `Fault`-Varianten und Factory-Funktionen                         |
| [Interceptors](./interceptors.md) | HTTP-/SSE-/WebSocket-Interceptor-Helfer                          |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## Verwandtes

- [Erste Schritte](/guide/getting-started)
- [GET mit deklariertem 404](/recipes/get-declared-404)
