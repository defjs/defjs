---
title: "SDK 設計"
description: "設計只描述契約、唔擁有應用程式 client 嘅操作、Struct 同套件。"
---

## 每個定義一個操作 [#one-operation]

每個操作都俾自己一個定義同 module。一個操作只有一個 method、一種 path 形狀、一份 input 同一份 output 契約。按操作拆分，契約會易讀啲，應用程式亦只需匯入佢真正會呼叫嘅操作。

推薦：

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

要避免嘅，係喺定義隔籬嘅 module 建立 client 或者存 endpoint。

## input 要配明確嘅 builder [#builder]

每個呼叫方提供嘅值都要喺 `input` 聲明，再由 `builder` 擺位。唔好靠 field 名啱好同 path 參數同名。`builder` 係同步同純粹嘅：佢可以重塑值，但唔可以讀 credentials、call network，或者改動共享狀態。

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

凡係過線嘅資料，都用 Struct。wire 名同 TypeScript 名唔同嘅時候，用 alias。業務規則、跨 field 驗證同正規化，都係應用程式嘅政策，唔係 Struct 嘅行為。

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## 用穩定嘅 operation 名 [#operation-name]

將 `operation` 設做低基數嘅身分，例如 `orders.read`。佢用嚟標示 telemetry 同診斷，但唔會帶 URL、使用者輸入，或者逐次請求先變嘅值。

## SDK 唔好帶執行狀態 [#no-client]

SDK 套件匯出定義、Struct 同 type。佢唔會 call `createClient`、唔會持有 singleton client，亦唔會讀環境變數。endpoint 同 credentials 由應用程式決定。

## 認真對待契約版本 [#versioning]

刪走 field、改 method 或者 path、收窄 input，都當係 breaking change。新增通常相容。套件嘅 peer range 要老實，出貨嘅定義文字要同應用程式編譯時用嘅一致，另外要為已發佈嘅套件記低 release tag。
