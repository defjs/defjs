---
title: "Skill"
description: "安裝 Defjs skill，讓助手編寫有型別嘅 GET 端點，並按項目已安裝嘅 SDK 核對結果。"
---

Defjs skill 讓助手了解 SDK 定義同應用執行嘅契約。支援 Skill 嘅助手可以喺相關任務入面載入佢；會唔會自動載入就睇所用工具。

## 安裝 skill [#install]

喺需要使用 Skill 嘅項目入面執行下面嘅命令。CLI 預設安裝到目前項目，可能自動偵測目前嘅 Agent，亦可能讓你選擇；可用 `-a` 明確指定。

```sh
bunx skills add defjs/defjs --skill defjs
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
