---
title: "AI 輔助開發"
description: "安裝 Defjs skill，讓助手編寫具型別的 GET 端點，並依專案已安裝的 SDK 核對結果。"
---

讓助手編寫 Defjs 程式，與從應用程式呼叫 AI 服務，是兩件不同的事。本頁是助手工作流程。[呼叫 AI API](/zh-Hant-TW/docs/ai-api) 是應用程式側的工作流程。支援 Skill 的助手可以在相關任務中載入它；是否自動載入取決於使用的工具。

## 安裝 skill [#install]

skills CLI 需要 Node.js 22.20 或更高版本。這個要求屬於安裝器，不是 `@defjs/core` 的執行環境。執行環境見[快速開始](/zh-Hant-TW/docs/start)。

在需要使用 Skill 的專案裡執行下面的命令。CLI 預設安裝到目前專案，可能自動偵測目前的 Agent，也可能讓你選擇；可用 `-a` 明確指定。

```sh
npx skills add defjs/defjs --skill defjs
```

發佈之後，可以在 [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md) 閱讀 skill 說明。GitHub 上的原始碼是預設分支，可能與專案裡已安裝的 `@defjs/core` 版本不同。

## 提出一個端點 [#prompt]

給助手一個任務。下面這段提示要求一個具型別的 `GET /orders/:id`，並且 client 留在應用程式裡：

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 核對結果 [#verify]

把定義和應用程式分開讀。定義匯出操作，不建立 client。應用程式建立 client 並呼叫操作，例如 `getOrder(client, { id: 1 })`。宣告了 `input` 時，`builder` 是明確的同步純函數。只有 error 槽是空的時才使用成功值。

然後執行該專案自己的型別檢查，以及真正執行這份契約的測試。相依套件安裝和 CI 規則留在那個專案裡。

## 給助手的英文 Markdown [#resources]

本站的指南、操作範例和 API 概覽是寫給人看的，每種語言都有自己的正文。下面三個位址只從英文頁面產生。它們沒有語言前綴，也不是你正在讀的這頁的譯文。

- [英文頁面索引](/llms.txt) 列出英文頁面並連結到對應網頁。
- [彙編後的英文指南](/llms-full.txt) 把這些頁面合成一個檔案。
- [快速開始的 Markdown](/llms.mdx/docs/start/content.md) 是其中一頁的英文正文。其他英文頁面使用同樣的形狀：`/llms.mdx/…/content.md`。

要看本語言的指南，讀[快速開始](/zh-Hant-TW/docs/start)。要讓助手對齊 API，把 Markdown 位址交給它。助手仍須遵守專案裡已安裝的 `@defjs/core` 版本：網站文件可能與已安裝的版本不同，應核對該版本的 API。文件的 GitHub 原始碼也是預設分支，同樣可能與已安裝版本不同。向 AI 工具提供程式碼或內容之前，先移除密鑰並確認專案的資料使用政策。
