---
title: "中介層"
description: "把 interceptor 組合為小型、有序的原則，並讓它們留在應用程式邊界。"
---

## 每個 interceptor 只做一件事 [#one-concern]

讓每個 interceptor 只負責一件事：附上身分驗證、加上追蹤 header、記錄耗時，或短路已核准的情況。一個同時做身分驗證、改寫 body、重試又記錄的中介層，既難測試也難理解。

建議：

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

避免讓單一 interceptor 改動請求中數個互不相關的部分。

## 順序就是原則 [#order]

Interceptors 依註冊順序執行。最先註冊的 interceptor 位於最外層：它最先看到請求，最後看到回應。必須包住整次嘗試的原則放在最外層；必須最靠近傳輸的原則放在最內層。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(trace, auth),
);
```

`trace` 包住 `auth`；`auth` 在傳輸之前執行。

## 刻意短路 [#short-circuit]

Interceptor 可以不呼叫 `next`，改用 `makeResponse` 回傳回應。適用於已核准的快取、維護時的回應，或本機測試。這個回應仍必須符合操作宣告的 output；不要把失敗變成成功。

## 不要改寫契約 [#contract]

中介層可以在函式庫的驗證規則內調整 headers、追蹤脈絡或請求 URL。它不得改變宣告的 input 或 output 意義。身分驗證與追蹤屬於這裡，不屬於 `builder`。

## 保持無狀態 [#stateless]

不要把每次請求的資料存在共用的 client 或模組上。把值透過請求、client 設定，或為該 client 建立的閉包傳遞。會改動共用狀態的中介層，會在並行呼叫之間外洩。

## 在邊界處理失敗 [#failures]

中介層丟出例外就是失敗；只有在中介層刻意處理了該請求時才回傳回應。不要只為了記錄而捕捉 fault，然後帶著 `undefined` 繼續。記錄請用應用程式的遙測 hook 或 interceptor，並讓定義同時不含兩者。
