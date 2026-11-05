---
title: "性能"
description: "流式发送大 body、限制队列、谨慎选择 failover，并在调整策略前先测量。"
---

## 流式处理大 body [#streaming]

不需要整体缓冲的 body 用 `ReadableStream` 发送；消费者能按块处理时，大响应也按流读取。JSON body 必须先完整物化再发送，但大文件上传不必如此。

`onUploadProgress` 和 `onDownloadProgress` 观察跨过 Fetch 边界的字节，不保证服务器已经接受或处理。它们适合用户反馈，不适合流控。

## 限制会增长的部分 [#bounds]

WebSocket 会话设置 `maxIncomingQueueSize`，SSE 设置 `maxBufferSize` / `maxQueueSize`。上限属于应用的背压策略：它决定慢消费者快速失败，还是把压力传回生产者。用生产相同的上限测试溢出路径。

## 谨慎选择 failover [#failover]

`withEndpointFailover` 只在你配置的策略下重试失败尝试。attempt 预算和 retry 预算保持小，不要用 failover 重复服务无法重放的非幂等请求。健康检查和惩罚应反映实际使用的传输。

## 先测量再调优 [#measure]

分别测量操作、传输和消费者。过短的 timeout 看起来像网络失败；过小的队列会把突发流量变成 fault。修改 buffer、timeout 或重试次数前，先用现有遥测 hook 和能复现负载的 fixture 测量。
