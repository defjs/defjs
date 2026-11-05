---
title: "中间件"
description: "把 interceptor 组合成小而有序、留在应用边界的策略。"
---

## 一个 interceptor 只做一件事 [#one-concern]

每个 interceptor 只负责一件事：附加鉴权、添加追踪 header、记录耗时，或短路一个经过批准的场景。同时做鉴权、改 body、重试和日志的中间件很难测试，也很难推理。

推荐：

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

避免用一个 interceptor 修改多个互不相关的请求部分。

## 顺序就是策略 [#order]

interceptor 按注册顺序运行。第一个注册的是最外层：最先看到请求，最后看到响应。必须包住整次尝试的策略放外层；必须靠近传输的策略放内层。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(trace, auth),
);
```

`trace` 包住 `auth`；`auth` 在传输之前运行。

## 有意识地短路 [#short-circuit]

interceptor 可以不调用 `next`，直接用 `makeResponse` 返回响应。它适用于经过批准的缓存、维护响应或本地测试。响应仍须满足操作声明的 output；不要把失败包装成成功。

## 不要改写契约 [#contract]

中间件可以在库的校验规则内调整 header、追踪上下文或请求 URL。它不能改变声明的 input 或 output 含义。鉴权和追踪属于这里，不属于 `builder`。

## 保持无状态 [#stateless]

不要在共享 client 或模块上保存每次请求的数据。通过请求、client 配置或为该 client 创建的闭包传递值。修改共享状态的中间件会在并发调用之间泄漏。

## 在边界处理失败 [#failures]

中间件抛出就是失败；只有中间件有意处理了请求时才返回响应。不要为了记日志就捕获 fault 然后继续使用 `undefined`。日志交给应用的遥测 hook 或 interceptor，定义里两者都不写。
