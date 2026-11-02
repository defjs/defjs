---
title: "AI 輔助開發"
description: "安裝 Defjs skill，讓助手編寫有型別嘅 GET 端點，並按項目已安裝嘅 SDK 核對結果。"
---

讓助手編寫 Defjs 程式，同從應用程式呼叫 AI 服務，係兩件不同嘅事。呢頁係助手工作流程。[呼叫 AI API](/zh-Hant-HK/docs/ai-api) 係應用程式側嘅工作流程。支援 Skill 嘅助手可以喺相關任務中載入佢；會唔會自動載入取決於所用工具。

## 安裝 skill [#install]

skills CLI 需要 Node.js 22.20 或更高版本。呢個要求屬於安裝器，唔係 `@defjs/core` 嘅執行環境。執行環境見[快速開始](/zh-Hant-HK/docs/start)。

喺需要使用 Skill 嘅項目入面執行下面嘅命令。CLI 預設安裝到目前項目，可能自動偵測目前嘅 Agent，亦可能讓你選擇；可用 `-a` 明確指定。

```sh
npx skills add defjs/defjs --skill defjs
```

發佈之後，可以喺 [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md) 閱讀 skill 說明。GitHub 上嘅原始碼係預設分支，可能同項目入面已安裝嘅 `@defjs/core` 版本不同。

## 提出一個端點 [#prompt]

畀助手一個任務。下面呢段提示要求一個有型別嘅 `GET /orders/:id`，而且 client 留喺應用程式入面：

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 核對結果 [#verify]

將定義同應用程式分開讀。定義匯出操作，唔建立 client。應用程式建立 client，再呼叫操作，例如 `getOrder(client, { id: 1 })`。宣告咗 `input` 時，`builder` 必須係明確嘅同步純函數。只有 error 槽係空嘅時候先使用成功值。

然後執行該項目自己嘅型別檢查，以及真正執行呢份契約嘅測試。相依套件安裝同 CI 規則留喺嗰個項目入面。

## 給助手嘅英文 Markdown [#resources]

本站嘅指南、操作範例同 API 概覽係寫畀人睇嘅，每種語言都有自己嘅正文。下面三個地址只從英文頁面產生。佢哋冇語言前綴，亦唔係你而家讀緊呢頁嘅譯文。

- [英文頁面索引](/llms.txt) 列出英文頁面並連結到對應網頁。
- [彙編後嘅英文指南](/llms-full.txt) 將呢啲頁面合成一個檔案。
- [快速開始嘅 Markdown](/llms.mdx/docs/start/content.md) 係其中一頁嘅英文正文。其他英文頁面使用同樣嘅形狀：`/llms.mdx/…/content.md`。

要睇本語言嘅指南，讀[快速開始](/zh-Hant-HK/docs/start)。要助手對齊 API，將 Markdown 地址交畀佢。助手仍然要遵守項目入面已安裝嘅 `@defjs/core` 版本：網站文件可能同已安裝版本不同，應核對該版本嘅 API。文件嘅 GitHub 原始碼都係預設分支，同樣可能同已安裝版本不同。向 AI 工具提供程式碼或內容之前，先移除密鑰並確認項目嘅資料使用政策。
