---
title: "指南"
description: 設計並發佈 SDK 契約與操作，並在使用端的應用程式裡設定執行。
---

Defjs 把團隊發佈的 API，與應用程式使用的 client 分開。從 SDK 撰寫路徑讀到如何定義並打包操作；從應用程式路徑設定執行並處理結果。

## SDK 開發 [#getting-started]

- [專案概覽](/zh-Hant-TW)
- [快速開始](/zh-Hant-TW/docs/start)
- [建置並發佈 SDK](/zh-Hant-TW/recipes/publish-http-sdk)
- [為什麼定義與執行要分開](/zh-Hant-TW/docs/design-decisions)

## 契約與執行 [#calls-and-contracts]

SDK 作者擁有 Struct 與端點定義。應用程式提供 Client，並用它呼叫操作。

- [資料契約 / Struct](/zh-Hant-TW/docs/struct)
- [用戶端設定 / Client](/zh-Hant-TW/docs/client)

## 請求與即時通訊

- [HTTP 請求](/zh-Hant-TW/docs/http)
- [SSE 事件串流](/zh-Hant-TW/docs/sse)
- [WebSocket 工作階段](/zh-Hant-TW/docs/web-socket)

## 錯誤與攔截

- [錯誤處理](/zh-Hant-TW/docs/errors)
- [攔截器](/zh-Hant-TW/docs/interceptors)

## 外掛

給使用端應用程式 client 的選用套件。SDK 定義與它們保持獨立。

- [外掛](/zh-Hant-TW/docs/integrations)
- [React](/zh-Hant-TW/docs/integrations/react)
- [Vue](/zh-Hant-TW/docs/integrations/vue)
- [OpenTelemetry server](/zh-Hant-TW/docs/integrations/opentelemetry-server)

## AI

- [AI 輔助開發](/zh-Hant-TW/docs/ai)
- [呼叫 AI API](/zh-Hant-TW/docs/ai-api)

[設計決策](/zh-Hant-TW/docs/design-decisions)
