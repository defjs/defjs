---
title: "应用集成"
description: "在应用边界创建 client，把凭证、策略和框架接线留在 SDK 之外。"
---

## 在边界创建一次 client [#client-boundary]

在应用读取配置的地方创建 client：服务端入口、拥有部署配置的模块，或测试初始化。把同一个 client 传给调用操作的代码。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

避免在 SDK 模块、组件函数体或请求处理器内部创建模块级 client。每次渲染或每次请求新建 client 会丢失共享配置，也让测试依赖环境状态。

## 横切策略放进 interceptor [#interceptors]

鉴权、追踪、默认 header 和经过审查的重试策略属于 interceptor。`builder` 只放置当前 input，不知道凭证或应用的遥测。

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## 用 client options 覆盖单次调用 [#per-call]

`client(options)` 返回一次调用使用的 client 值，这个值不可调用。用它传入 signal、进度回调或只对本次调用生效的 WebSocket hook；其余情况继续使用基础 client。

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## 让框架插件传递 client [#plugins]

`@defjs/react` 和 `@defjs/vue` 把应用 client 传过框架树。它们不创建、缓存、重试或释放 client。传入应用已经拥有的 client，并在需要的地方注入同一个值。

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## endpoint 不进入 SDK [#endpoint]

同一份定义可以针对生产、预发、本地 fixture 或测试传输运行。在应用中选择 endpoint，不要把部署主机写进 SDK 包。
