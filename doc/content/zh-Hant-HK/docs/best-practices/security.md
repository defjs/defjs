---
title: "安全"
description: "將 credentials 留喺應用程式邊界，驗證 URL，需要時開 XSRF，並且遮蓋 telemetry。"
---

## 秘密唔好入 SDK 同瀏覽器 [#secrets]

SDK 定義唔會包含 endpoint、token 或者 credential。應用程式將 credentials 放喺一個喺准許使用佢哋嘅地方運行嘅 client 上面：server process、worker，或者受信任嘅測試。唔好將 provider secret 放喺瀏覽器 bundle、公開嘅 build variable，或者會送去瀏覽器嘅 client 入面。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(serverAuth),
);
```

## 用 interceptor 做認證 [#auth]

喺應用程式邊界運行嘅 interceptor 入面掛 token。`builder` 一定要保持係純粹嘅擺位函數；佢唔可以讀 token store，亦唔可以改動另一個 call 會用到嘅 header。

## 喺 client 設定 XSRF [#xsrf]

服務用 cookie-to-header token 嘅時候，喺應用程式 client 設定 `withXsrf`。`withCredentials` 只係揀 Fetch 嘅 cookie 模式；佢唔會建立或者驗證 token。Token 仍然要由 server 簽發同驗證。

## 驗證應用程式控制嘅嘢 [#urls]

Defjs 會喺 transport 執行之前，拒絕非法嘅 request path、走出目錄、反斜線、`?`、`#` 同控制字元。佢唔知你嘅應用程式信任邊啲 host。endpoint 清單要寫得明確，使用者提供嘅值要喺入到 `builder` 之前驗證，亦唔好用唔可信嘅輸入砌 base URL。

## log 或者 trace 之前先遮蓋 [#redaction]

URL、query string、headers 同 body 都可能帶秘密或者個人資料。OpenTelemetry 插件預設唔會捕捉 body 或者完整 headers；保持原狀。喺 `startSpanHook` 或者應用程式嘅 exporter 入面遮蓋，亦唔好將原始請求值複製去自訂 telemetry。

## 將 abort 當成局部操作 [#abort]

取消只係停低本地工作。佢唔證明服務停咗已經接收嘅工作，亦唔會回滾 server 端嘅效果。非 idempotent 操作要配返服務自己嘅取消契約。
