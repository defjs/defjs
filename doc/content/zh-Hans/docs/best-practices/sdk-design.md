---
title: "SDK 设计"
description: "设计只描述契约、不持有应用 client 的操作、Struct 和包。"
---

## 一个操作一个定义 [#one-operation]

每个操作有独立的定义和模块。一个操作只有一种 method、一种 path 形状、一份 input 和一份 output 契约。按操作拆分让契约更易读，也让应用只导入真正调用的操作。

推荐：

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

避免在定义旁边创建 client 或保存 endpoint。

## input 与显式 builder 成对 [#builder]

把调用方提供的值都声明在 `input`，并在 `builder` 中放置。不要依赖字段名恰好等于 path 参数。`builder` 是同步纯函数：它可以重塑值，但不能读取凭证、发起网络请求或修改共享状态。

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## Struct 描述线上形状 [#structs]

Struct 用于跨线传输的数据。线上名称与 TypeScript 名称不同时使用 alias。业务规则、跨字段校验和归一化属于应用策略，不属于 Struct 行为。

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## 使用稳定的 operation 名称 [#operation-name]

把 `operation` 设为 `orders.read` 这类低基数身份。它用于标记遥测和诊断，不携带 URL、用户输入或每次请求的值。

## SDK 不持有执行状态 [#no-client]

SDK 包导出定义、Struct 和类型。它不调用 `createClient`、不保存单例 client、不读取环境变量。endpoint 和凭证由应用决定。

## 有意识地管理版本 [#versioning]

删除字段、改变 method 或 path、收窄 input 都属于破坏性变更；新增通常是兼容的。保持包声明的 peer 范围真实，发布时使用应用实际编译的定义文本，并为已发布的包记录 release tag。
