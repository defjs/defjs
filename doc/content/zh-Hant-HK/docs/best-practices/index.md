---
title: "總覽"
description: "喺 SDK 作者、應用程式同唔同 runtime 之間，用契約同邊界令 SDK 保持可預測。"
---

呢啲做法唔係 Defjs 運作所必需。佢哋嘅用處，係當定義、應用程式同 transport 分別由幾個人負責嗰陣，仍然令 SDK 保持可預測。每頁都由一條規則開始，示範推薦同要避免嘅寫法，再解釋背後嗰條邊界。

## 定義同執行分開 [#definition-execution]

定義係資料。佢聲明 method、path、input、output 同錯誤契約，但唔會建立 client、唔會讀 credentials，亦唔會發起 I/O。應用程式負責建立 client 同呼叫操作；呼叫操作先至會真正發出請求。

呢個分法令 SDK 套件出貨時唔使帶 endpoint 同 credentials，亦令同一份定義可以喺瀏覽器、伺服器或者測試入面，用唔同 endpoint 執行。

## 聲明 input，明確擺位 [#input-builder]

`input` 描述呼叫方提供嘅值。`builder` 決定每個值放去邊：path、query、headers 定 body。擺位永遠唔會由 field 名或者 path 模板推斷出嚟。

`builder` 係同步純函數，喺執行時運行。佢拋出嘅錯誤會變成 `REQ_BUILD_FAILED`。

## 先讀 error 位 [#error-first]

每個操作都回傳 error-first tuple。第一項係 fault 或者 `null`。請求、response 同 transport 失敗都唔會喺呼叫點拋出。

用成功值之前，先讀 fault。按 `code` 收窄，再讀嗰個 fault 帶住嘅 field。

## 應用程式擁有 client [#client-ownership]

應用程式擁有 endpoint、credentials、interceptor、transport，以及 stream 同 session 嘅生命週期。SDK 擁有契約。插件可以將應用程式嘅 client 傳過框架樹，但唔會建立或者快取 client。

## 本節頁面 [#pages]

- [SDK 設計](/zh-Hant-HK/docs/best-practices/sdk-design) — 定義、Struct、命名同發佈。
- [應用整合](/zh-Hant-HK/docs/best-practices/application) — 建立 client、設定、interceptor 同框架插件。
- [錯誤處理](/zh-Hant-HK/docs/best-practices/errors) — fault code、收窄、log 同 retry。
- [串流與即時](/zh-Hant-HK/docs/best-practices/streaming) — SSE、WebSocket、擁有權同 backpressure。
- [測試](/zh-Hant-HK/docs/best-practices/testing) — 注入 transport、契約測試同 timer。
- [安全](/zh-Hant-HK/docs/best-practices/security) — credentials、XSRF、URL 驗證同遮蓋。
- [效能](/zh-Hant-HK/docs/best-practices/performance) — 串流、queue、failover 同量度。
