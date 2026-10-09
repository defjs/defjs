---
title: Defjs
description: 明示的なクライアントとエラーファーストな結果で、型付きの HTTP・SSE・WebSocket コマンドを扱います。
---

# Defjs

エンドポイントを定義し、不透明なコマンドを組み立てて実行します。HTTP、SSE、WebSocket で同じ形です。

```ts get-health.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getHealth = defineRequest({
  method: 'GET',
  path: '/health',
  output: struct.object({ ok: struct.boolean() }),
})

const [error, result, response] = await client.execute(getHealth())
if (!error) console.log(result.ok, response.status)
```

Defjs は結果をキャッシュしたり、代わりにリトライしたり、忘れられたストリームを閉じたりしません。キャンセルとクリーンアップは呼び出し側の責任です。

## トランスポートを選ぶ

| やりたいこと                         | ここから                          | 成功時の結果                                              |
| ------------------------------------ | --------------------------------- | --------------------------------------------------------- |
| リクエストと status ごとのレスポンス | [HTTP](./core/http.md)            | デコード済みデータ + `HttpResponse`                       |
| 長寿命のサーバーイベントフィード     | [SSE](./core/sse.md)              | 1 つのストリーム + 起動時の `open` スナップショット       |
| 双方向セッション                     | [WebSocket](./core/web-socket.md) | 1 つのセッション + 起動時の `connection` スナップショット |

初めてなら [はじめに](./guide/getting-started.md) をやってから、[レシピ](./recipes/get-declared-404.md) を拾ってみてください。「なぜ？」が気になるときは、何か動かしたあとに [設計上の判断](./guide/design-decisions.md) を読むとよいです。

## パッケージを選ぶ

| パッケージ                    | いつ                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@defjs/core`                 | `createClient`（HTTP + SSE + WebSocket）                                                             |
| `@defjs/react`                | `ClientProvider` / `useClient` — [React](./plugins/react.md) を参照                                  |
| `@defjs/vue`                  | プラグイン + `injectClient` — [Vue](./plugins/vue.md) を参照                                         |
| `@defjs/opentelemetry-server` | アウトバウンドのスパン/メトリクス — [OpenTelemetry Server](./plugins/opentelemetry-server.md) を参照 |

## 結果の形

3 つのトランスポートとも、エラーファーストの 3 要素タプルを返します。位置は揃っていますが、意味は違います。

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`
- WebSocket → `[error, session, connection]`

起動に失敗したとき、2 番目は `undefined` です。3 番目はそのトランスポートが先にレスポンスやスナップショットを出したときだけ存在します。[Errors](./core/errors.md) を見てください。

## 所有権をひと息で

古くなった HTTP は abort します。SSE は close して `await stream.closed`。WebSocket も close して `await session.closed`。サーバーでは、options が cookie・認証・テナントデータを掴むなら、クライアントをリクエスト境界の中で作ります。ログに出す前に URL・ヘッダー・ボディを redact してください。

## 関連レシピ

- [宣言済み 404 付きの GET](./recipes/get-declared-404.md)
- [POST JSON](./recipes/post-json.md)
- [HTTP 呼び出しをキャンセルする](./recipes/cancel-http.md)
- [SSE ストリームを消費する](./recipes/consume-sse.md)
- [WebSocket セッションを開く](./recipes/websocket-session.md)
- [ローカル Fetch ハンドルでテストする](./recipes/test-with-handle.md)
