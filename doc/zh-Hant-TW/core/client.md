---
title: Client
description: 建立明確的 client、組合 options、執行 commands，並自己負責清理。
---

# Client

`Client` 持有 endpoint + 傳輸設定，並分派 HTTP、SSE、WebSocket commands。它不會快取、自動重試，也不會幫你看著開著的串流。

## Basic Setup

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)` 會依 command 種類回傳 overloads。

## 組合 options

Options 由左到右套用。Setter 會取代；`withInterceptors(...items)` 會追加。

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

混合的 interceptors 在執行時依傳輸篩選；被選中種類之間的相對順序會保留。

## 依傳輸執行

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`（`open` 是啟動快照；`stream.open` 在重連後可能變）
- WebSocket → `[error, session, connection]`

WebSocket execute 可覆寫 `beforeConnect`、`heartbeat`、`protocols`、`reconnect`。`timeout` 必須是 `1..2_147_483_647` 的正 safe integer。

清理由你負責：abort HTTP、close SSE + `await stream.closed`、close WebSocket + `await session.closed`。

## 注入測試傳輸

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

## 伺服器 vs 瀏覽器的範圍

在伺服器上，若 options 或 interceptor closures 會捕捉 auth、cookies、users、tenants，請在請求邊界內建立 client。Client 身分本身不是安全邊界。

## Reference

| Helper                                                                                                        | 效果                                                       |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | 所有傳輸共用的絕對 base endpoint                           |
| `withHeaders(HeadersInit)`                                                                                    | HTTP／SSE 的靜態預設 headers；command headers 會覆寫       |
| `withTimeout(ms)`                                                                                             | 只當 HTTP `execute` 的預設 timeout（SSE／WS 會忽略）       |
| `withHTTPHandle(fetch)`                                                                                       | 替換 HTTP 的 Fetch                                         |
| `withSSEHandle(fetch)`                                                                                        | 替換 SSE 的 Fetch                                          |
| `withWebSocketHandle(WebSocket)`                                                                              | 替換 WebSocket constructor                                 |
| `withInterceptors(...items)`                                                                                  | 追加混合 interceptors                                      |
| `withQuerySerializer(fn)`                                                                                     | 把已經套過 alias 的 query 物件編成 query string            |
| `withCredentials(boolean)`                                                                                    | 為 true 時，HTTP／SSE 的 Fetch 用 `credentials: 'include'` |
| `withXSRF(options?)`                                                                                          | HTTP XSRF cookie → header                                  |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | SSE 旋鈕                                                   |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | WebSocket 旋鈕                                             |

## 相關 recipes

- [用本機 Fetch handle 測試](../recipes/test-with-handle.md)
- [取消 HTTP 呼叫](../recipes/cancel-http.md)
