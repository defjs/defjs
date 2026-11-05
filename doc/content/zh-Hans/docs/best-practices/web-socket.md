---
title: "WebSocket"
description: "拥有会话、读取接收队列、限制两个队列，并处理运行时错误与重连。"
---

## 拥有会话 [#ownership]

WebSocket 会话属于打开它的调用方。工作结束时关闭；作用域拥有它时使用 `await using`，确保每条退出路径都会释放。

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## 读到会话关闭 [#read-to-end]

持续读取 `session.receive`，直到会话关闭或调用方停止。不要假设第一条消息就是最后一条。应用需要观察会话打开后的传输失败时，注册 `onRuntimeError`。

## 限制两个队列 [#bounds]

为等待消费者的消息设置 `maxIncomingQueueSize`，为重连期间排队的消息设置 `maxOutgoingQueueSize`。有界限制让慢消费者或长时间重连变成 fault，而不是无界内存增长。用生产相同的上限测试溢出路径。

## 有意识地设置重连与心跳 [#reconnect]

重连和心跳是 client 选项。重连会创建新的连接尝试；排队的 outgoing 消息遵循队列策略。心跳收不到确认时，应用要判断这是失败，而不是无限发送下去。

## 关闭，不要泄漏 [#close]

`close()` 开始关闭；`closed` 报告终态。会话不可写后再发送会抛出；检查状态或处理抛出。下一步依赖传输已释放时，等待 `closed`。
