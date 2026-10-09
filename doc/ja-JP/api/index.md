---
title: API リファレンス
description: ワークスペースパッケージの手書き参照 — import する関数、options、型です。
---

# API リファレンス

ワークスペースパッケージの参照です。シグネチャが契約で、いつ使うかはガイドとレシピが説明します。

## パッケージ

| パッケージ                                                 | ここで探すもの                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@defjs/core`](./client.md)                               | `createClient`, `defineRequest`, `struct`, HTTP / SSE / WebSocket |
| [`@defjs/vue`](./vue.md)                                   | `createClientPlugin`, `injectClient`                              |
| [`@defjs/react`](./react.md)                               | `ClientProvider`, `useClient`                                     |
| [`@defjs/opentelemetry-server`](./opentelemetry-server.md) | `withOpenTelemetryServer`                                         |

## @defjs/core

| ページ                            | ここで探すもの                                                   |
| --------------------------------- | ---------------------------------------------------------------- |
| [Client](./client.md)             | `createClient`, `with*` options, `Client`                        |
| [HTTP](./http.md)                 | `defineRequest`, execute options, `HttpRequest` / `HttpResponse` |
| [Struct](./struct.md)             | `struct.*`, `Infer`, `StructError`                               |
| [Errors](./errors.md)             | `Fault` の種類とファクトリ                                       |
| [Interceptors](./interceptors.md) | HTTP / SSE / WebSocket の interceptor ヘルパー                   |
| [SSE](./sse.md)                   | `defineEventStream`, stream handle                               |
| [WebSocket](./web-socket.md)      | `defineWebSocket`, session                                       |

## 関連

- [はじめよう](/guide/getting-started)
- [宣言済み 404 付きの GET](/recipes/get-declared-404)
