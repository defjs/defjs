---
title: "安全"
description: "把凭证留在应用边界，校验 URL，按需启用 XSRF，并对遥测脱敏。"
---

## 凭证不进入 SDK 和浏览器 [#secrets]

SDK 定义不包含 endpoint、token 或凭证。应用把凭证放在允许使用它的 client 上：服务端进程、worker 或可信测试。不要把服务密钥放进浏览器包、公开构建变量或发往浏览器的 client。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(serverAuth),
);
```

## 用 interceptor 做鉴权 [#auth]

在应用边界运行的 interceptor 中附加 token。`builder` 必须保持纯放置函数，不能读取 token 存储，也不能修改其他调用共用的 header。

## 在 client 上配置 XSRF [#xsrf]

服务使用 cookie-to-header token 时，在应用 client 上配置 `withXsrf`。`withCredentials` 只选择 Fetch 的 cookie 模式，不创建或校验 token。服务器仍须签发并校验 token。

## 校验应用控制的值 [#urls]

Defjs 在传输运行前拒绝非法请求路径、目录逃逸、反斜杠、`?`、`#` 和控制字符。它不知道你的应用信任哪些 host。endpoint 列表保持显式，用户提供的值进入 `builder` 前先校验，不要用不可信输入拼接 base URL。

## 记录日志或追踪前脱敏 [#redaction]

URL、query、header 和 body 可能含密钥或个人数据。OpenTelemetry 插件默认不采集 body 和完整 header，保持这个默认值。在 `startSpanHook` 或应用 exporter 中脱敏，不要把原始请求值复制到自定义遥测。

## 中止只是本地行为 [#abort]

取消只停止本地工作，不证明服务停止了已经接受的工作，也不会回滚服务端副作用。对非幂等操作，中止要与服务自己的取消契约配合。
