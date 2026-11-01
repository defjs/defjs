---
title: "指南"
description: 設計 SDK 契約同操作、發佈出去，並喺使用方應用程式設定執行。
---

Defjs 分開兩樣嘢：團隊發佈嘅 API，同應用程式用嘅 client。跟 SDK 作者嗰條路，可以讀到點樣定義同封裝操作；跟應用程式嗰條路，設定執行同處理結果。

## SDK 開發 [#getting-started]

- [項目概覽](/zh-Hant-HK)
- [快速開始](/zh-Hant-HK/docs/start)
- [建置並發佈 SDK](/zh-Hant-HK/recipes/publish-http-sdk)
- [點解定義同執行要分開](/zh-Hant-HK/docs/design-decisions)

## 契約與執行 [#calls-and-contracts]

SDK 作者擁有 Struct 同端點定義。應用程式提供 Client，再用佢呼叫操作。

- [資料契約 / Struct](/zh-Hant-HK/docs/struct)
- [客戶端設定 / Client](/zh-Hant-HK/docs/client)

## 請求與即時通訊

- [HTTP 請求](/zh-Hant-HK/docs/http)
- [SSE 事件流](/zh-Hant-HK/docs/sse)
- [WebSocket 會話](/zh-Hant-HK/docs/web-socket)

## 錯誤與攔截

- [錯誤處理](/zh-Hant-HK/docs/errors)
- [攔截器](/zh-Hant-HK/docs/interceptors)

## 插件

可選套件，用喺使用方應用程式嘅 client。SDK 定義唔依賴佢哋。

- [插件](/zh-Hant-HK/docs/integrations)
- [React](/zh-Hant-HK/docs/integrations/react)
- [Vue](/zh-Hant-HK/docs/integrations/vue)
- [OpenTelemetry 伺服器端](/zh-Hant-HK/docs/integrations/opentelemetry-server)

## AI

- [AI 輔助開發](/zh-Hant-HK/docs/ai)
- [呼叫 AI API](/zh-Hant-HK/docs/ai-api)

[設計決策](/zh-Hant-HK/docs/design-decisions)
