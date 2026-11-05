---
title: "流式与实时"
description: "拥有流句柄、限制队列大小，并在应用中决定重连与重放策略。"
---

## 拥有句柄 [#ownership]

事件流或 WebSocket 会话属于打开它的调用方。工作结束时关闭；作用域拥有它时使用 `await using`，确保每条退出路径都会释放。

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 读到完成或 EOF [#read-to-end]

一个事件不是完整响应。SSE 要持续读取，直到流结束、调用方中止，或重连策略接管。WebSocket 要读取接收队列，直到会话关闭或调用方停止。

## 限制缓冲与队列 [#bounds]

WebSocket 会话设置 `maxIncomingQueueSize`，SSE 设置 `maxBufferSize` / `maxQueueSize`。有界限制让慢消费者变成 fault，而不是无界内存增长。根据消息大小和消费者速度选择上限，并测试溢出路径。

## 显式决定重连与重放 [#reconnect]

SSE 重连默认关闭，由应用显式开启。POST 等非幂等方法不会再次发送，除非策略明确允许。一次失败的流式尝试可能已经在服务端开始工作；开启策略前，先读 [SSE 事件流](/zh-Hans/docs/sse) 的重连规则和 [HTTP 请求](/zh-Hans/docs/http) 的重放规则。

## 关闭，不要泄漏 [#close]

`close()` 开始关闭；`closed` 报告终态。下一步依赖传输已释放时，等待 `closed`。中止只结束本地工作，不证明服务停止了已经接受的工作。
