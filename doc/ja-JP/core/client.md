---
title: Client
description: 明示的なクライアントを作り、options を合成し、コマンドを実行し、クリーンアップを所有します。
---

# Client

`Client` はエンドポイント + トランスポート設定を持ち、HTTP・SSE・WebSocket コマンドをディスパッチします。キャッシュも自動リトライも、開いたストリームの世話もしません。

## Basic Setup

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)` はコマンド種別ごとのオーバーロードを返します。

## options を合成する

options は左から右へ適用されます。setter は置換、`withInterceptors(...items)` は追記です。

```typescript twoslash
import { createClient, createHttpInterceptor, withCredentials, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit), withCredentials(true))
void client
```

混在インターセプターは実行時にトランスポートでフィルタされ、選ばれた種別内の相対順はそのままです。

## トランスポート別に実行する

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`（`open` は起動時スナップショット。`stream.open` は再接続後に変わり得る）
- WebSocket → `[error, session, connection]`

WebSocket の execute は `beforeConnect`、`heartbeat`、`protocols`、`reconnect` を上書きできます。`timeout` は `1..2_147_483_647` の正の安全な整数である必要があります。

クリーンアップは呼び出し側の責任です。HTTP は abort、SSE は close + `await stream.closed`、WebSocket は close + `await session.closed`。

## テスト用トランスポートを注入する

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
})

const handle: typeof fetch = async () => Response.json({ id: 7, name: 'Ada' })
const client = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(handle))
const [error, user] = await client.execute(getUser({ id: 7 }))
if (!error) console.log(user.name)
```

## サーバーとブラウザーでのスコープ

サーバーでは、options やインターセプターのクロージャが認証・cookie・ユーザー・テナントを掴むなら、クライアントをリクエスト境界の中で作ります。クライアントの同一性そのものがセキュリティ境界ではありません。

## Reference

| ヘルパー                                                                                                      | 効果                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | 全トランスポートの絶対ベースエンドポイント                             |
| `withHeaders(HeadersInit)`                                                                                    | HTTP/SSE の静的なデフォルトヘッダー。コマンドのヘッダーが上書きする    |
| `withTimeout(ms)`                                                                                             | HTTP の `execute` のデフォルト timeout だけ（SSE/WS は無視する）       |
| `withHTTPHandle(fetch)`                                                                                       | HTTP の Fetch を差し替え                                               |
| `withSSEHandle(fetch)`                                                                                        | SSE の Fetch を差し替え                                                |
| `withWebSocketHandle(WebSocket)`                                                                              | WebSocket コンストラクタを差し替え                                     |
| `withInterceptors(...items)`                                                                                  | 混在インターセプターを追記                                             |
| `withQuerySerializer(fn)`                                                                                     | エイリアス適用済みの query オブジェクトを query 文字列にエンコードする |
| `withCredentials(boolean)`                                                                                    | true のとき HTTP/SSE で Fetch `credentials: 'include'`                 |
| `withXSRF(options?)`                                                                                          | HTTP の XSRF cookie → ヘッダー                                         |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | SSE のつまみ                                                           |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | WebSocket のつまみ                                                     |

## 関連レシピ

- [ローカル Fetch ハンドルでテストする](../recipes/test-with-handle.md)
- [HTTP 呼び出しをキャンセルする](../recipes/cancel-http.md)
