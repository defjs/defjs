---
title: "操作範例"
description: 建置並發布可重用的 SDK，並在取用端應用程式中設定身分驗證、請求呼叫與即時連線。
---

建議先從[建置並發布 SDK](/zh-Hant-TW/recipes/publish-http-sdk)開始，走完從匯出 SDK 定義到 npm 套件、再由應用程式取用的完整流程。下列每個範例都會把一份操作契約與其周邊的應用程式策略配在一起，並以多檔案程式碼分頁展示 SDK 定義與應用程式執行模組如何搭配。

## HTTP

- [傳送 JSON](/zh-Hant-TW/recipes/post-json) — 把邏輯上的 camelCase 欄位對應到傳輸上的 `snake_case` 鍵，並解碼具型別的 `201` 回應。
- [處理已宣告的 404](/zh-Hant-TW/recipes/get-declared-404) — 依具型別的 `200` 輸出與已宣告的 `404` `HTTP_STATUS` 錯誤本文分支。
- [取消與逾時](/zh-Hant-TW/recipes/cancel-http) — 結合呼叫端的 `AbortController` 與 `AbortSignal.timeout(...)`，並明確區分 `NET_ABORTED` 與 `NET_TIMEOUT`。
- [ETag 條件請求](/zh-Hant-TW/recipes/etag-revalidate) — 發送 `If-None-Match`，將 `304 Not Modified` 作為 `HTTP_STATUS` 錯誤處理，並在應用程式程式碼中維護快取 `Map`。
- [GraphQL 請求](/zh-Hant-TW/recipes/graphql-http-envelope) — 透過 HTTP `POST` 發送 GraphQL 查詢，並在應用程式輔助函式中拆解 `errors[]` 與 `.nullish()` 的 `data`。

## 身分驗證

- [401 後重新整理 token](/zh-Hant-TW/recipes/refresh-bearer-once) — 在單一 HTTP 攔截器內附加 `Bearer` token、去除並行重新整理的重複，並重試一次。

## 即時通訊

- [消費 SSE 串流](/zh-Hant-TW/recipes/consume-sse) — 開啟具型別的 Server-Sent Events 串流、迭代一次，並在 `finally` 區塊確保 `stream.close()` + `await stream.closed`。
- [管理 WebSocket 工作階段](/zh-Hant-TW/recipes/websocket-session) — 交換具型別的 incoming／outgoing JSON 訊框、訂閱 `onRuntimeError`，並正常關閉。

## SDK 測試與發布 [#testing-and-packaging]

- [本機 HTTP 測試](/zh-Hant-TW/recipes/test-with-handle) — 以 `withHTTPHandle(...)` 在記憶體中測試 URL 建構、攔截器與 struct 解碼。
- [建置並發布 SDK](/zh-Hant-TW/recipes/publish-http-sdk) — 以 `tsdown` 打包並發布不含 client 的 SDK，再從應用程式取用它。
