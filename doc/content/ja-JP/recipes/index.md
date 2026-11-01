---
title: "実践例"
description: SDK のテストと公開、HTTP・認証・リアルタイム通信の実装に使う実践例です。
---

export した定義から npm パッケージと利用アプリケーションまでの全体は、[SDK の作成と公開](/ja-JP/recipes/publish-http-sdk) から始めてください。以下の実践例は、その SDK の周りに組み合わせられる個々の操作の契約と、アプリケーション方針の設計です。

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

## SDK のテストと公開 [#testing-and-packaging]

- [ローカル HTTP テスト](/ja-JP/recipes/test-with-handle)
- [SDK の作成と公開](/ja-JP/recipes/publish-http-sdk)
