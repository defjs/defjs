---
title: Defjs
description: 型別化的 HTTP、SSE、WebSocket 指令，搭配明確的 client 與 error-first 結果。
---

# Defjs

定義 endpoint、建立不透明的 command，再執行它。HTTP、SSE、WebSocket 都是同一套形狀。

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

Defjs 不會幫你快取結果、自動重試，也不會在你忘記時關掉串流。取消與清理由你負責。

## 選傳輸方式

| 你要的                    | 從這裡開始                        | 成功時的結果                              |
| ------------------------- | --------------------------------- | ----------------------------------------- |
| 請求 + 依狀態碼區分的回應 | [HTTP](./core/http.md)            | 解碼後的資料 + `HttpResponse`             |
| 長生命週期的伺服器事件流  | [SSE](./core/sse.md)              | 一個串流 + 啟動時的 `open` 快照           |
| 雙向工作階段              | [WebSocket](./core/web-socket.md) | 一個 session + 啟動時的 `connection` 快照 |

第一次用？先走[開始使用](./guide/getting-started.md)，再抓一份[recipe](./recipes/get-declared-404.md)。想知道「為什麼這樣設計」？跑過範例後再看[設計決策](./guide/design-decisions.md)。

## 選套件

| 套件                          | 何時用                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `@defjs/core`                 | `createClient`（HTTP + SSE + WebSocket）                                          |
| `@defjs/react`                | `ClientProvider` / `useClient` — 見 [React](./plugins/react.md)                   |
| `@defjs/vue`                  | Plugin + `injectClient` — 見 [Vue](./plugins/vue.md)                              |
| `@defjs/opentelemetry-server` | 出站 spans/metrics — 見 [OpenTelemetry Server](./plugins/opentelemetry-server.md) |

## 結果形狀

三種傳輸都回傳 error-first 的三項 tuple。位置對齊，意義不一樣：

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`
- WebSocket → `[error, session, connection]`

啟動失敗時第二項是 `undefined`。第三項只有在該傳輸先產出回應或快照時才會存在。詳見[錯誤](./core/errors.md)。

## 擁有權一句話講完

HTTP 過期就 abort。SSE 要 close 並 `await stream.closed`。WebSocket 要 close 並 `await session.closed`。在伺服器上，若 options 會捕捉 cookies、auth 或 tenant 資料，請在請求邊界內建立 client。記錄前先遮罩 URL、headers、bodies。

## 相關 recipes

- [已宣告 404 的 GET](./recipes/get-declared-404.md)
- [POST JSON](./recipes/post-json.md)
- [取消 HTTP 呼叫](./recipes/cancel-http.md)
- [消費 SSE 串流](./recipes/consume-sse.md)
- [開啟 WebSocket session](./recipes/websocket-session.md)
- [用本機 Fetch handle 測試](./recipes/test-with-handle.md)
