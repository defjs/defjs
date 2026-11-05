---
title: "安全"
description: "把憑證留在應用程式邊界、驗證 URL、在需要處啟用 XSRF，並遮蔽遙測資料。"
---

## 讓 secrets 遠離 SDK 與瀏覽器 [#secrets]

SDK 定義不含 endpoint、token 或憑證。應用程式把憑證放在允許使用它們的地方執行的 client 上：伺服器程序、worker 或受信任的測試。不要把供應商 secret 放進瀏覽器 bundle、公開建置變數，或送到瀏覽器的 client。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(serverAuth),
);
```

## 用 interceptor 做身分驗證 [#auth]

在應用程式邊界執行的 interceptor 中附加 token。`builder` 必須維持純粹的放置函式；它不得讀取 token store，也不得改動其他呼叫會用到的 header。

## 在 client 上設定 XSRF [#xsrf]

服務使用 cookie-to-header token 時，在應用程式 client 上設定 `withXsrf`。`withCredentials` 只選擇 Fetch 的 cookie 模式，不會建立或驗證 token。伺服器仍必須簽發並驗證 token。

## 驗證應用程式能控制的部分 [#urls]

Defjs 會在傳輸執行前拒絕非法請求 path、目錄跳脫、反斜線、`?`、`#` 與控制字元。它不知道你的應用程式信任哪些主機。明確維護 endpoint 清單，在使用者提供的值進入 `builder` 前先驗證，且不要用不受信任的輸入組出 base URL。

## 在記錄或追蹤前遮蔽 [#redaction]

URL、query string、header 與 body 可能含有 secrets 或個人資料。OpenTelemetry 外掛預設不擷取 body 或完整 header；維持這個設定。在 `startSpanHook` 或應用程式的 exporter 中遮蔽，且不要複製原始請求值到自訂遙測。

## 把 abort 視為本機操作 [#abort]

取消只停止本機工作。它不能證明服務已停止先前接受的工作，也不會回滾伺服器端的效果。對非冪等操作，把中止與服務自身的取消契約搭配使用。
