---
title: "應用整合"
description: "在應用程式邊界建立 client，讓憑證、策略與框架接線留在 SDK 之外。"
---

## 在邊界建立一次 client [#client-boundary]

在應用程式讀取設定的地方建立 client：伺服器進入點、擁有部署的模組，或測試設定。把該 client 傳給呼叫操作的程式碼。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

避免把模組層級的 client 放進 SDK、元件本體或請求處理常式。每次 render 或每次請求都建立 client，會失去共享設定，也讓測試依賴環境狀態。

## 把橫切策略放進 interceptor [#interceptors]

身分驗證、追蹤、預設 header 與審過的重試策略都屬於 interceptor。`builder` 只放置當前 input；它不認識憑證，也不認識應用程式的遙測。

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## 用 client options 處理單次呼叫 [#per-call]

`client(options)` 回傳供單次呼叫使用的 client 值。該值不可呼叫。用它傳遞 signal、進度回呼，或只套用在該次呼叫的 WebSocket hook；其餘情況仍使用基礎 client。

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## 讓框架外掛傳遞 client [#plugins]

`@defjs/react` 與 `@defjs/vue` 讓應用程式的 client 流經框架樹。它們不會建立、快取、重試或釋放 client。提供應用程式原本就擁有的 client，並在需要的地方注入同一個值。

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## 別把 endpoint 放進 SDK [#endpoint]

同一份定義可以對生產、預備環境、本機 fixture 或測試傳輸執行。在應用程式中選擇 endpoint；不要把部署主機寫進 SDK 套件。
