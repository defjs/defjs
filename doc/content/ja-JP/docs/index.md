---
title: "ガイド"
description: SDK の契約と操作を設計して公開し、利用するアプリケーションで実行を構成します。
---

Defjs は、チームが公開する API と、アプリケーションが使うクライアントを分けます。操作を定義してパッケージにする経路は SDK 作成が担当し、実行を構成して結果を扱う経路はアプリケーションが担当します。

## はじめに [#getting-started]

- [プロジェクト概要](/ja-JP)
- [クイックスタート](/ja-JP/docs/start)
- [SDK の作成と公開](/ja-JP/recipes/publish-http-sdk)
- [定義と実行を分ける理由](/ja-JP/docs/design-decisions)

## コア概念 [#core-concepts]

- [データ構造 / Struct](/ja-JP/docs/struct)
- [Client](/ja-JP/docs/client)
- [ミドルウェア](/ja-JP/docs/interceptors)
- [エラー](/ja-JP/docs/errors)

## リクエストとリアルタイム通信

- [HTTP リクエスト](/ja-JP/docs/http)
- [SSE イベントストリーム](/ja-JP/docs/sse)
- [WebSocket セッション](/ja-JP/docs/web-socket)

## プラグイン

利用アプリケーションのクライアント向けの任意パッケージです。SDK の定義はそれらから独立したままです。

- [プラグイン](/ja-JP/docs/integrations)
- [React](/ja-JP/docs/integrations/react)
- [Vue](/ja-JP/docs/integrations/vue)
- [OpenTelemetry server](/ja-JP/docs/integrations/opentelemetry-server)

## AI

- [AI を活用した開発](/ja-JP/docs/ai)
- [AI API の呼び出し](/ja-JP/docs/ai-api)

[設計上の判断](/ja-JP/docs/design-decisions)
