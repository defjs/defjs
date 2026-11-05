---
title: "测试"
description: "用注入传输、真实 tuple 和可控时间测试定义契约。"
---

## 注入传输 [#inject]

用 `withHTTPHandle`、`withSSEHandle` 或 `withWebSocketHandle` 替换平台传输。操作仍会构建请求、运行 interceptor、解码响应，因此测试覆盖真实的契约边界。

```ts
const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
const [error, order] = await getOrder(client, { id: 7 });
expect(error).toBeNull();
expect(order?.status).toBe("paid");
```

## 断言 tuple，不断言内部 [#tuple]

检查 fault code 和解码后的值。断言私有 helper 调用或传输实现细节的测试，会在实现变化但契约不变时失败。对 fault，断言 `code`、相关字段，以及作为契约一部分的 `cause` 身份。

## 契约 fixture 保持真实 [#fixtures]

改动请求构建、解码或流关闭时，为每种传输保留一个对真实服务器的集成测试。使用仓库已有的 fixture 服务器，不要另造一套 mock 协议。浏览器专属行为放在浏览器项目，服务端专属行为放在服务端项目。

## 显式控制时间 [#time]

超时、backoff、重连延迟和心跳使用 fake timers。等到被测事件发生后再推进时间，并断言应该运行的代码路径。不要断言实际经过的墙钟时间。真实 socket 等待具体事件，例如 `open`、`closed` 或第一帧。

## 以消费者身份测试 SDK [#consumer]

SDK 测试应导入应用导入的定义，用测试传输创建 client，再调用操作。不要手工重建请求；那是在测试测试代码，而不是 SDK。
