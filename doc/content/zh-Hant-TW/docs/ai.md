---
title: "Skill"
description: "安裝 Defjs skill，讓助手編寫具型別的 GET 操作，並依專案已安裝的 SDK 核對結果。"
---

Defjs skill 讓助手掌握 SDK 定義與應用程式執行的契約。支援的助手可能會在相關任務中載入它；是否自動啟用取決於所用工具。

## 安裝 skill [#install]

在要接收 skill 的專案中執行下列命令。CLI 預設安裝到目前專案，可能會偵測目前的 agent，或請你選擇；可用 `-a` 明確指定。

```sh
bunx skills add defjs/defjs --skill defjs
```

發布之後，可以在 [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md) 閱讀 skill 說明。GitHub 上的原始碼是預設分支，可能與專案裡已安裝的 `@defjs/core` 版本不同。

## 提出一項操作 [#prompt]

給助手一個任務。下面這段提示要求一個具型別的 `GET /orders/:id`，並讓 client 留在應用程式裡：

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 核對結果 [#verify]

把定義與應用程式分開檢視。定義匯出操作，不建立 client。應用程式建立 client 並呼叫操作，例如 `getOrder(client, { id: 1 })`。有宣告 `input` 時，`builder` 是明確的同步純函式。只有 error 欄位為空時，才使用成功值。

接著執行該專案自己的型別檢查，以及涵蓋這份契約的測試。相依套件安裝與 CI 規則仍由該專案負責。
