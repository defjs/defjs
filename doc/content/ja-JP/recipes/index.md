---
title: "実践例"
description: SDK のテストと公開、HTTP・認証・リアルタイム通信の実装に使う実践例です。
---

SDK の定義を設計・テスト・公開し、その定義をアプリケーションで使うための実践例です。SDK は API の契約を export し、アプリケーションは Client の設定、結果、キャンセル、ストリームのライフサイクルを管理します。

## SDK のテストと公開 [#テストとパッケージ化]

- [ローカル HTTP テスト](/ja-JP/recipes/test-with-handle)
- [SDK の作成と公開](/ja-JP/recipes/publish-http-sdk)

## HTTP

- [JSON の送信](/ja-JP/recipes/post-json)
- [宣言済み 404 の処理](/ja-JP/recipes/get-declared-404)
- [キャンセルとタイムアウト](/ja-JP/recipes/cancel-http)
- [ETag 条件付きリクエスト](/ja-JP/recipes/etag-revalidate)
- [GraphQL リクエスト](/ja-JP/recipes/graphql-http-envelope)

## 認証

- [401 後のトークン更新](/ja-JP/recipes/refresh-bearer-once)

## リアルタイム通信

- [SSE イベントの受信](/ja-JP/recipes/consume-sse)
- [WebSocket セッションの管理](/ja-JP/recipes/websocket-session)
