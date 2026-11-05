---
title: "應用整合"
description: "喺應用程式邊界建立 client，將 credentials、政策同框架接駁留喺 SDK 外面。"
---

## 喺邊界建立一次 client [#client-boundary]

喺應用程式讀自己設定嘅地方建立 client：server 嘅 entry point、擁有部署嘅 module，或者 test setup。再將嗰個 client 傳俾呼叫操作嘅 code。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

要避免嘅係：SDK 入面有 module-level client、喺 component body 入面建 client，或者喺 request handler 入面建 client。每次 render 或者每個請求都開一個 client，會失去共享設定，亦令測試依賴周圍嘅狀態。

## 橫切政策放喺 interceptor [#interceptors]

認證、追蹤、預設 headers，同審過嘅 retry 政策，都屬於 interceptor。`builder` 只負責擺放今次嘅 input；佢唔識 credentials，亦唔知應用程式嘅 telemetry。

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## 單次呼叫用 client options [#per-call]

`client(options)` 回傳一個只供單次呼叫用嘅 client 值。呢個值唔可以 call。signal、progress callback，或者只對嗰次呼叫生效嘅 WebSocket hook，就用佢嚟傳；其他嘢繼續用 base client。

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## 由框架插件傳 client [#plugins]

`@defjs/react` 同 `@defjs/vue` 會將應用程式嘅 client 傳過框架樹。佢哋唔會建立、快取、retry 或者 dispose client。你只需要提供應用程式本身已經擁有嘅 client，再喺需要嘅地方注入同一個值。

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## endpoint 唔好入 SDK [#endpoint]

同一份定義可以對住 production、staging、本地 fixture，或者 test transport 執行。endpoint 喺應用程式揀；唔好將部署 host 寫死喺 SDK 套件入面。
