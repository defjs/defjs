---
title: "效能"
description: "大型 body 用串流，為 queue 設上限，慎重揀 failover，改政策之前先量度。"
---

## 大型 body 用串流 [#streaming]

唔應該 buffer 嘅 body，就用 `ReadableStream` 送；consumer 可以逐塊處理嘅話，大型 response 就當 stream 咁讀。JSON body 送之前一定要完整砌好；大型 upload 就唔使。

`onUploadProgress` 同 `onDownloadProgress` 觀察嘅係經過 Fetch 邊界嘅 bytes。佢哋唔係保證 server 已經接收或者處理咗個 body。用嚟做使用者回饋就得，唔好用嚟做 flow control。

## 會增長嘅嘢要設上限 [#bounds]

WebSocket session 設 `maxIncomingQueueSize`，SSE 設 `maxBufferSize` / `maxQueueSize`。上限係應用程式 backpressure 政策嘅一部分：佢決定慢嘅 consumer 係即刻失敗，定係向 producer 施加壓力。測試 overflow 路徑時，用同 production 一樣嘅上限。

## 慎重選擇 failover [#failover]

`withEndpointFailover` 只會喺你設定嘅政策之下，retry 一次失敗咗嘅嘗試。嘗試預算同 retry 預算都要細，亦唔好用 failover 去重複一個服務重播唔到嘅非 idempotent 請求。health check 或者 penalty 要反映你實際用嘅 transport。

## 調校之前先量度 [#measure]

操作、transport 同 consumer 要分開量度。timeout 設得太短，睇落就好似網絡失敗；queue 設得太細，一個 burst 就會變成 fault。改 buffer、timeout 或者 retry 次數之前，用現有嘅 telemetry hook，同一個重現到負載嘅 fixture。
