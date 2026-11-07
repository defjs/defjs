---
title: "実践例"
description: 再利用可能な SDK の構築・公開から、利用側アプリケーションでの認証、通信、リアルタイム処理の構成例を紹介します。
---

まずは、エクスポートされた SDK 定義から npm パッケージの作成、利用側アプリケーションでの利用までの一連の流れを解説した [SDK の作成と公開](/ja-JP/recipes/publish-http-sdk) をご覧ください。各実践例では、具体的な操作契約の設計とアプリケーションポリシーを、SDK 定義モジュールと実行モジュールを分けた複数ファイルのコードタブ形式で紹介しています。

## HTTP

- [JSON の送信](/ja-JP/recipes/post-json) — TypeScript の camelCase フィールドを通信用の `snake_case` キーにマッピングし、型付けされた `201` レスポンスをデコードします。
- [宣言済み 404 の処理](/ja-JP/recipes/get-declared-404) — 型付けされた `200` の正常出力と、宣言された `404` の `HTTP_STATUS` エラーボディで分岐します。
- [キャンセルとタイムアウト](/ja-JP/recipes/cancel-http) — 呼び出し元の `AbortController` と `AbortSignal.timeout(...)` を組み合わせ、`NET_ABORTED` と `NET_TIMEOUT` を区別して扱います。
- [ETag 条件付きリクエスト](/ja-JP/recipes/etag-revalidate) — `If-None-Match` を送信し、`304 Not Modified` を `HTTP_STATUS` Fault として捉え、キャッシュ `Map` をアプリケーション側で管理します。
- [GraphQL リクエスト](/ja-JP/recipes/graphql-http-envelope) — HTTP `POST` 経由で GraphQL クエリを送信し、ヘルパー関数内で `errors[]` と `.nullish()` な `data` をアンラップします。

## 認証

- [401 後のトークン自動更新](/ja-JP/recipes/refresh-bearer-once) — `Bearer` トークンを付与し、並行するリフレッシュ処理の重複を排除して、単一の HTTP インターセプター内で 1 度だけリトライします。

## リアルタイム通信

- [SSE イベントの受信](/ja-JP/recipes/consume-sse) — 型付けされた Server-Sent Events ストリームを開いて反復処理し、`finally` ブロックで `stream.close()` と `await stream.closed` を確実に実行します。
- [WebSocket セッションの管理](/ja-JP/recipes/websocket-session) — 型付けされた送受信 JSON フレームをやり取りし、`onRuntimeError` を購読してセッションを終了します。

## SDK のテストと公開 [#testing-and-packaging]

- [ローカル HTTP テスト](/ja-JP/recipes/test-with-handle) — `withHTTPHandle(...)` を使用して、URL 構築、インターセプター、Struct のデコードをインメモリでテストします。
- [SDK の作成と公開](/ja-JP/recipes/publish-http-sdk) — クライアントを持たない SDK を `tsdown` でパッケージ化して公開し、アプリケーションから利用します。
