---
title: "錯誤處理"
description: "在呼叫點讀取 fault、按 code 窄化，並把記錄與重試留在定義之外。"
---

## 先讀 fault，再讀值 [#fault-first]

每個操作都回傳 `[error, data, response]`。只有第一個元素是 `null` 時，成功值才有意義。

建議：

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

避免：

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // order is undefined when the call failed
```

## 先按 code 窄化，再按資料窄化 [#narrow]

`fault.code` 選出失敗類別。`HTTP_STATUS` 讀 `status`，解碼後的錯誤 body 讀 `data`，中繼資料讀 `response`。`cause` 保留底層的剖析器或傳輸失敗；不要用泛用訊息取代它。

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

`RES_*` 表示回應無法按宣告讀取。`NET_*` 表示請求沒有產生可用的回應。不要把解碼或契約失敗當成網路失敗來重試。

## 只在擁有結果的邊界記錄一次 [#logging]

在決定後續動作的層記錄：請求處理常式、工作執行器或 UI 邊界。遙測請用 OpenTelemetry 外掛或 interceptor；定義本身不含記錄。URL、query string、header 與 body 進入 log 前要先遮蔽。

## 只重試可安全重放的請求 [#retry]

Defjs 不會自行重試 HTTP。重試屬於應用程式，或屬於明確的 endpoint 容錯移轉策略。重試安全方法，或服務文件載明為冪等的操作。可能已經開始計費工作的 POST，若沒有重放契約，就不安全。

## 不要吞掉錯誤 [#no-swallow]

出錯後回傳成功會掩蓋破裂的契約。把 fault 映射成應用程式結果、重新拋出程式設計錯誤，或以具型別的失敗結束操作。不要只為了記錄而捕捉 fault，然後帶著 undefined 值繼續執行。
