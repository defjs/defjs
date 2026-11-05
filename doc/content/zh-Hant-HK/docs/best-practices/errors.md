---
title: "錯誤處理"
description: "喺呼叫點讀 fault，按 code 收窄，log 同 retry 留喺定義外面。"
---

## 先讀 fault，再讀值 [#fault-first]

每個操作都回傳 `[error, data, response]`。只有第一項係 `null` 嗰陣，成功值先有意義。

推薦：

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

要避免：

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // order is undefined when the call failed
```

## 先按 code 收窄，再按 data [#narrow]

`fault.code` 揀出失敗類別。`HTTP_STATUS` 睇 `status`，已解碼嘅 error body 睇 `data`，metadata 睇 `response`。`cause` 保留底層嘅 parser 或者 transport 失敗；唔好用一句籠統訊息換走佢。

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

`RES_*` code 表示 response 讀唔成聲明嘅樣。`NET_*` code 表示個請求根本冇產生可用嘅 response。唔好將解碼或者契約失敗當成網絡失敗咁 retry。

## 喺擁有結果嘅邊界 log 一次 [#logging]

喺決定下一步點做嘅嗰層 log：request handler、job runner，或者 UI 邊界。Telemetry 用 OpenTelemetry 插件或者 interceptor；定義本身唔應該有 log。URL、query string、headers 同 body 入 log 之前，要先遮蓋。

## 只 retry 可以安全重播嘅嘢 [#retry]

Defjs 唔會自己 retry HTTP。retry 屬於應用程式，或者屬於一條明確嘅 endpoint failover 政策。只 retry 安全嘅 method，或者服務文件寫明係 idempotent 嘅操作。一個可能已經開始計費工作嘅 POST，冇 replay 契約就唔安全重複。

## 唔好吞咗個錯誤 [#no-swallow]

出錯之後照回成功，只會遮住一條壞咗嘅契約。你可以將 fault 映射成應用程式嘅結果、重新拋出程式錯誤，或者用一個有 type 嘅失敗結束操作。唔好捉住個 fault 淨係為咗 log 佢，然後攞住個 undefined 值繼續行。
