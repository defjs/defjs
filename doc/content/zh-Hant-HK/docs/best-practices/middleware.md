---
title: "中介層"
description: "將 interceptor 組合成細小、有次序嘅政策，並留喺應用程式邊界。"
---

## 每個 interceptor 只做一件事 [#one-concern]

每個 interceptor 只俾一個任務：附加認證、加一個 trace header、記錄耗時，或者為已審批嘅情況短路。一個同時做認證、改寫 body、retry 同 log 嘅 middleware，好難測試，亦好難推理。

建議咁寫：

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

避免一個 interceptor 改動 request 幾個互不相關嘅部分。

## 次序就係政策 [#order]

Interceptor 按註冊次序執行。第一個註冊嘅 interceptor 係最外層：佢最先見到 request，最後見到 response。要包住成次嘗試嘅政策放喺最外層；要最貼近 transport 嘅政策放喺最內層。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(trace, auth),
);
```

`trace` 包住 `auth`；`auth` 喺 transport 之前執行。

## 刻意短路 [#short-circuit]

Interceptor 可以唔 call `next`，直接用 `makeResponse` 回傳一個 response。用嚟做已審批嘅快取、維護中嘅回應，或者本地測試。個 response 仍然要符合操作已聲明嘅 output；唔好將失敗變成成功。

## 唔好改寫契約 [#contract]

Middleware 可以喺 library 嘅驗證規則之內調整 headers、trace context 或者 request URL。但唔可以改變已聲明 input 或 output 嘅意思。認證同追蹤屬於呢度，唔屬於 `builder`。

## 保持無狀態 [#stateless]

唔好將每個 request 嘅資料存放喺共用 client 或者 module 上面。將值經 request、client 設定，或者為嗰個 client 建立嘅 closure 傳遞。一個會改共用狀態嘅 middleware，會喺並發呼叫之間漏出去。

## 喺邊界處理失敗 [#failures]

Middleware throw 就係失敗；只有 middleware 刻意處理咗個 request 時，先回傳 response。唔好單為咗 log 就 catch 一個 fault，然後攞住 `undefined` 繼續行。Log 用應用程式嘅 telemetry hook 或者 interceptor，而 definition 兩樣都唔應該有。
