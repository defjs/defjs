---
title: "範例"
description: 建置並發佈可重用 SDK，再喺使用方應用程式設定認證、呼叫同即時工作。
---

# 範例

由[建置並發佈 SDK](/zh-Hant-HK/recipes/publish-http-sdk)開始，睇由匯出 SDK 定義到 npm 套件再到使用方應用程式嘅完整流程。下面每個範例都將一個操作契約同周圍嘅應用程式策略配對，並用多檔案程式碼分頁展示 SDK 定義同應用程式執行模組點樣配合運作。

## HTTP

- [發送 JSON](/zh-Hant-HK/recipes/post-json) — 將邏輯 camelCase 欄位映射到網絡 `snake_case` key，並解碼帶型別嘅 `201` 回應。
- [處理已宣告嘅 404](/zh-Hant-HK/recipes/get-declared-404) — 按帶型別嘅 `200` 輸出，同已宣告嘅 `404` `HTTP_STATUS` 錯誤 body 分支。
- [取消與逾時](/zh-Hant-HK/recipes/cancel-http) — 結合呼叫端 `AbortController` 與 `AbortSignal.timeout(...)`，區分 `NET_ABORTED` 同 `NET_TIMEOUT`。
- [ETag 條件請求](/zh-Hant-HK/recipes/etag-revalidate) — 發送 `If-None-Match`，將 `304 Not Modified` 當作 `HTTP_STATUS` fault 處理，並將快取 `Map` 保留喺應用程式代碼中。
- [GraphQL 請求](/zh-Hant-HK/recipes/graphql-http-envelope) — 透過 HTTP `POST` 發送 GraphQL 查詢，並喺應用程式輔助函式中拆解 `errors[]` 與 `.nullish()` `data`。
- [游標分頁](/zh-Hant-HK/recipes/cursor-pagination) — 用非同步生成器（async generator）串流處理分頁 API 結果，並轉發逐頁 `AbortSignal` 取消訊號。
- [冪等鍵](/zh-Hant-HK/recipes/idempotency-key) — 用 `idempotencyKeyHttpInterceptor` 喺 `POST`/`PATCH` 重試之間自動附上 `Idempotency-Key` header。
- [並發限制與池化呼叫](/zh-Hant-HK/recipes/concurrency-limit) — 用 `concurrencyLimitHttpInterceptor` 同 `@defjs/core/concurrent` 原語限制進行中嘅請求數量。
- [Undici Pool HTTP handle](/zh-Hant-HK/recipes/undici-pool) — 將 `undici.Pool` 橋接到 `withHTTPHandle`，喺 Node.js 入面使用 keep-alive 連線池。

## 認證

- [401 後更新 Bearer token 一次](/zh-Hant-HK/recipes/refresh-bearer-once) — 掛上 `Bearer` token、合併去重並發嘅 refresh 請求，並喺單一 HTTP 攔截器內重放一次。

## 即時通訊

- [使用 SSE 事件流](/zh-Hant-HK/recipes/consume-sse) — 開啟帶型別嘅 Server-Sent Events 事件流，迭代一次，並喺 `finally` 區塊保證執行 `stream.close()` + `await stream.closed`。
- [管理 WebSocket 會話](/zh-Hant-HK/recipes/websocket-session) — 收發帶型別嘅傳入／傳出 JSON frame、訂閱 `onRuntimeError`，並乾淨咁關閉連線。

## SDK 測試與發佈 [#testing-and-packaging]

- [本地 HTTP 測試](/zh-Hant-HK/recipes/test-with-handle) — 用 `withHTTPHandle(...)` 喺記憶體內測試 URL 建構、攔截器同 Struct 解碼。
- [建置並發佈 SDK](/zh-Hant-HK/recipes/publish-http-sdk) — 用 `tsdown` 打包並發佈零 client 嘅 SDK，然後喺應用程式入面使用。
