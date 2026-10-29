---
title: "ガイド"
description: SDK の API 定義、契約の検証、パッケージ公開、利用アプリケーションでの実行を順に学びます。
---

Defjs（define js）は、再利用できる API 定義から SDK を作るための仕組みです。SDK の作成者は契約を公開し、利用するアプリケーションは Defjs Client の設定と実行を担当します。

## SDK 開発 [#はじめに]

1. [プロジェクト概要](/ja-JP) で作成者とアプリケーションの責務を確認します。
2. [クイックスタート](/ja-JP/docs/start) で定義を export し、別ファイルの Client で実行します。
3. [ローカル HTTP テスト](/ja-JP/recipes/test-with-handle) で実行時の契約を検証します。
4. [SDK の作成と公開](/ja-JP/recipes/publish-http-sdk) で定義と型宣言を配布します。

## 契約と実行 [#呼び出しと契約]

- [データ契約 / Struct](/ja-JP/docs/struct) — 入力・出力・エラーとワイヤ表現を定義します。
- [定義と実行 / Command](/ja-JP/docs/commands) — 定義、エンドポイント、1 回の実行用のコマンドを区別します。
- [クライアント設定 / Client](/ja-JP/docs/client) — アプリケーションの endpoint、認証、トランスポートを構成します。

## リクエストとリアルタイム通信

- [HTTP リクエスト](/ja-JP/docs/http)
- [SSE イベントストリーム](/ja-JP/docs/sse)
- [WebSocket セッション](/ja-JP/docs/web-socket)

## エラーとインターセプター

- [エラー処理](/ja-JP/docs/errors) — 宣言されたエラーと実行時の失敗をアプリケーションで扱います。
- [インターセプター](/ja-JP/docs/interceptors) — 認証やトレーシングなどの実行方針を合成します。

## プラグイン

- [プラグイン](/ja-JP/docs/integrations)
- [React](/ja-JP/docs/integrations/react)
- [Vue](/ja-JP/docs/integrations/vue)
- [OpenTelemetry server](/ja-JP/docs/integrations/opentelemetry-server)

[設計上の判断](/ja-JP/docs/design-decisions) では、SDK の定義とアプリケーションの実行設定を分ける理由を説明します。
