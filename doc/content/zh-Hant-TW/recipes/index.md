---
title: "操作範例"
description: 建置並發布可重用的 SDK，並在取用端應用程式中設定身分驗證、請求呼叫與即時連線。
---

建議先從[建置並發布 SDK](/zh-Hant-TW/recipes/publish-http-sdk)開始，走完從匯出 SDK 定義到 npm 套件與取用端應用程式的完整流程。下列實戰範例能幫助你充分掌握各個獨立的操作契約與應用程式策略，並透過多檔案程式碼標籤頁展示 SDK 定義端與應用程式執行端模組如何緊密協作。

## HTTP

- [傳送 JSON](/zh-Hant-TW/recipes/post-json) — 將邏輯上的 camelCase 欄位對應至網路通訊的 `snake_case` 鍵名，並解碼具型別的 `201` 回應。
- [處理已宣告的 404](/zh-Hant-TW/recipes/get-declared-404) — 在具型別的 `200` 輸出與已宣告的 `404` `HTTP_STATUS` 錯誤本文之間進行分支處理。
- [取消與逾時](/zh-Hant-TW/recipes/cancel-http) — 結合呼叫端的 `AbortController` 與 `AbortSignal.timeout(...)`，並明確區分 `NET_ABORTED` 與 `NET_TIMEOUT`。
- [ETag 條件請求](/zh-Hant-TW/recipes/etag-revalidate) — 發送 `If-None-Match`，將 `304 Not Modified` 作為 `HTTP_STATUS` 錯誤處理，並在應用程式程式碼中維護快取 `Map`。
- [GraphQL 請求](/zh-Hant-TW/recipes/graphql-http-envelope) — 透過 HTTP `POST` 發送 GraphQL 查詢，並在應用程式輔助函式中拆解 `errors[]` 與 `.nullish()` 的 `data`。

## 身分驗證

- [401 後更新權杖](/zh-Hant-TW/recipes/refresh-bearer-once) — 在單一 HTTP 攔截器內部附加 `Bearer` Token、去除並發更新請求的重複執行，並進行一次性重試。

## 即時通訊

- [使用 SSE 事件串流](/zh-Hant-TW/recipes/consume-sse) — 開啟具型別的 Server-Sent Events 串流，迭代接收一次，並在 `finally` 區塊中確保 `stream.close()` + `await stream.closed`。
- [管理 WebSocket 工作階段](/zh-Hant-TW/recipes/websocket-session) — 雙向交換具型別的收發 JSON 封包、訂閱 `onRuntimeError`，並乾淨關閉連線。

## SDK 測試與發布 [#testing-and-packaging]

- [本機 HTTP 測試](/zh-Hant-TW/recipes/test-with-handle) — 使用 `withHTTPHandle(...)` 在記憶體中離線測試 URL 建構、攔截器與 Struct 解碼。
- [建置並發布 SDK](/zh-Hant-TW/recipes/publish-http-sdk) — 使用 `tsdown` 打包並發布零 Client 依賴的 SDK，並從應用程式端進行取用。
