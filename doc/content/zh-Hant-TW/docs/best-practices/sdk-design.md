---
title: "SDK 設計"
description: "設計能描述契約、卻不持有應用程式 client 的操作、Struct 與套件。"
---

## 每份定義一個操作 [#one-operation]

為每個操作各自建立定義與模組。一個操作只有一個 method、一種 path 形狀、一份 input 與一份 output 契約。依操作拆分能讓契約保持易讀，也讓應用程式只匯入它會呼叫的操作。

建議：

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

避免在定義旁建立 client 或儲存 endpoint 的模組。

## 為 input 搭配明確的 builder [#builder]

在 `input` 宣告每個呼叫端提供的值，並在 `builder` 中放置。不要依賴欄位名稱剛好對上 path 參數。`builder` 是同步且純粹的：它可以重塑值，但不得讀取憑證、呼叫網路或改動共享狀態。

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## Struct 描述 wire 形狀 [#structs]

用 Struct 描述跨 wire 的資料。當 wire 名稱與 TypeScript 名稱不同時使用 alias。業務規則、跨欄位驗證與正規化屬於應用程式策略，不是 Struct 行為。

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## 使用穩定的 operation 名稱 [#operation-name]

把 `operation` 設為低基數的身分標識，例如 `orders.read`。它為遙測與診斷加上標籤，但不夾帶 URL、使用者輸入或每次請求的值。

## 讓 SDK 不含執行狀態 [#no-client]

SDK 套件匯出定義、Struct 與型別。它不呼叫 `createClient`、不持有單例 client，也不讀取環境變數。endpoint 與憑證由應用程式決定。

## 審慎地為契約定版 [#versioning]

把移除欄位、變更 method 或 path，以及收窄 input 視為破壞性變更。新增通常是相容的。讓套件的 peer range 保持誠實，用與應用程式編譯時相同的定義文字發佈，並為發佈的套件記錄 release tag。
