---
title: "操作例子"
description: 建置並發佈可重用 SDK，再喺使用方應用程式設定認證、呼叫同即時工作。
---

由[建置並發佈 SDK](/zh-Hant-HK/recipes/publish-http-sdk)開始，睇由匯出 SDK 定義到 npm 套件再到使用方應用程式嘅完整開發旅程。下面嘅實用配方展示咗個別操作契約同應用程式策略，並提供多檔案程式碼分頁，幫你掌握 SDK 定義同應用程式執行模組點樣天衣無縫咁配合。

## HTTP

- [發送 JSON](/zh-Hant-HK/recipes/post-json) — 將邏輯 camelCase 欄位映射到網絡 `snake_case` key，並解碼具型別嘅 `201` 回應。
- [處理已聲明嘅 404](/zh-Hant-HK/recipes/get-declared-404) — 區分具型別嘅 `200` 輸出同宣告過嘅 `404` `HTTP_STATUS` 錯誤 body 分支。
- [取消與逾時](/zh-Hant-HK/recipes/cancel-http) — 結合呼叫端 `AbortController` 與 `AbortSignal.timeout(...)`，明確區分 `NET_ABORTED` 同 `NET_TIMEOUT`。
- [ETag 條件請求](/zh-Hant-HK/recipes/etag-revalidate) — 發送 `If-None-Match`，將 `304 Not Modified` 視為 `HTTP_STATUS` fault，並將快取 `Map` 保留喺應用程式代碼中。
- [GraphQL 請求](/zh-Hant-HK/recipes/graphql-http-envelope) — 透過 HTTP `POST` 發送 GraphQL 查詢，並喺應用程式輔助函式中拆解 `errors[]` 與 `.nullish()` `data`。

## 認證

- [401 後更新令牌](/zh-Hant-HK/recipes/refresh-bearer-once) — 掛載 `Bearer` token、自動合併去重並發嘅 refresh 請求，並喺單一 HTTP 中介層內自動重放一次。

## 即時通訊

- [使用 SSE 事件流](/zh-Hant-HK/recipes/consume-sse) — 開啟帶型別嘅 Server-Sent Events 事件流，迭代消費，並喺 `finally` 區塊保證 `stream.close()` + `await stream.closed`。
- [管理 WebSocket 會話](/zh-Hant-HK/recipes/websocket-session) — 收發具型別嘅傳入／傳出 JSON frame、訂閱 `onRuntimeError`，並乾淨清理連線。

## SDK 測試與發佈 [#testing-and-packaging]

- [本地 HTTP 測試](/zh-Hant-HK/recipes/test-with-handle) — 用 `withHTTPHandle(...)` 喺記憶體內測試 URL 建構、中介層同 Struct 解碼。
- [建置並發佈 SDK](/zh-Hant-HK/recipes/publish-http-sdk) — 用 `tsdown` 打包並發佈零 client 嘅 SDK，然後喺應用程式中引用執行。
