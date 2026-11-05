---
title: "错误处理"
description: "在调用点读取 fault，按 code 收窄，并把日志和重试留在定义之外。"
---

## 先读 fault，再读值 [#fault-first]

每个操作返回 `[error, data, response]`。只有第一个元素为 `null` 时，成功值才有意义。

推荐：

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

避免：

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // 调用失败时 order 是 undefined
```

## 先按 code，再按 data 收窄 [#narrow]

`fault.code` 选择失败类别。`HTTP_STATUS` 读 `status`，已解码的错误 body 读 `data`，元数据读 `response`。`cause` 保留底层解析或传输失败，不要用泛化消息替换它。

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

`RES_*` 表示响应无法按声明读取，`NET_*` 表示请求没有产生可用响应。不要把解码或契约失败当作网络失败重试。

## 在拥有结果的边界记录一次日志 [#logging]

在决定下一步的层记录日志：请求处理器、任务执行器或 UI 边界。遥测交给 OpenTelemetry 插件或 interceptor；定义里不写日志。URL、query、header 和 body 进入日志前先脱敏。

## 只重试可以安全重放的操作 [#retry]

Defjs 不会自动重试 HTTP。重试属于应用，或属于显式的 endpoint failover 策略。只重试安全方法，或服务明确声明幂等的操作。可能已经开始计费工作的 POST，在没有重放契约时不能重复发送。

## 不要吞掉错误 [#no-swallow]

出错后返回成功会掩盖坏掉的契约。把 fault 映射成应用结果、重新抛出编程错误，或用类型化失败结束操作。不要只记一条日志就继续使用 undefined 值。
