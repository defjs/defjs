---
title: "總覽"
description: "讓 SDK 在 SDK 作者、應用程式與執行環境之間保持可預測的契約與邊界。"
---

這些做法不是 Defjs 運作的必要條件。當定義、應用程式與傳輸由不同的人擁有時，它們能讓 SDK 保持可預測。每一頁都從一條規則出發，示範建議與應避免的寫法，並說明背後的邊界。

## 讓定義與執行保持分離 [#definition-execution]

定義是資料。它宣告 method、path、input、output 與錯誤契約，不會建立 client、讀取憑證或啟動 I/O。應用程式建立 client 並呼叫操作。呼叫操作才會實際發出請求。

這道分界讓 SDK 套件可以不含 endpoint、不含憑證地發佈，也讓同一份定義能在瀏覽器、伺服器或測試中以不同的 endpoint 執行。

## 宣告 input，明確放置 [#input-builder]

`input` 描述呼叫端提供的值。`builder` 決定每個值放進 path、query、headers 還是 body。放置位置絕不從欄位名稱或 path 範本推斷。

`builder` 是同步的純函式，在執行時執行。它拋出的例外會變成 `REQ_BUILD_FAILED`。

## 先讀錯誤槽位 [#error-first]

每個操作都回傳 error-first tuple。第一個元素是 fault 或 `null`。請求、回應與傳輸失敗都不會在呼叫點拋出。

先讀 fault，再使用成功值。以 `code` 窄化，然後讀取屬於該 fault 的欄位。

## 應用程式擁有 client [#client-ownership]

endpoint、憑證、interceptors、傳輸，以及串流與工作階段的生命週期，都歸應用程式所有。SDK 擁有契約。外掛可以讓應用程式的 client 流經框架樹，但不會建立或快取 client。

## 本節頁面 [#pages]

- [SDK 設計](/zh-Hant-TW/docs/best-practices/sdk-design) — 定義、Struct、命名與發佈。
- [應用整合](/zh-Hant-TW/docs/best-practices/application) — client 建立、設定、interceptors 與框架外掛。
- [錯誤處理](/zh-Hant-TW/docs/best-practices/errors) — fault code、窄化、記錄與重試。
- [串流與即時](/zh-Hant-TW/docs/best-practices/streaming) — SSE、WebSocket、擁有權與背壓。
- [測試](/zh-Hant-TW/docs/best-practices/testing) — 注入傳輸、契約測試與計時器。
- [安全](/zh-Hant-TW/docs/best-practices/security) — 憑證、XSRF、URL 驗證與遮蔽。
- [效能](/zh-Hant-TW/docs/best-practices/performance) — 串流、佇列、容錯移轉與量測。
