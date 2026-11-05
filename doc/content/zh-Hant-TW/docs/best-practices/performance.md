---
title: "效能"
description: "以串流處理大型 body、為佇列設上限、審慎選擇容錯移轉，並先量測再改策略。"
---

## 串流大型 body [#streaming]

對不應緩衝的 body 送出 `ReadableStream`；當消費者能處理區塊時，以串流讀取大型回應。JSON body 必須完整具體化後才能送出；大型上傳則不必。

`onUploadProgress` 與 `onDownloadProgress` 觀察跨過 Fetch 邊界的位元組。它們不保證伺服器已接受或處理 body。用於使用者回饋，不要用於流量控制。

## 為可成長的部分設上限 [#bounds]

為 WebSocket 工作階段設定 `maxIncomingQueueSize`，為 SSE 設定 `maxBufferSize` / `maxQueueSize`。上限是應用程式背壓策略的一部分：它決定慢速消費者要快速失敗，或對生產者施加壓力。用生產環境相同的上限測試溢位路徑。

## 審慎選擇容錯移轉 [#failover]

`withEndpointFailover` 只在你設定的策略下重試失敗的嘗試。讓嘗試預算與重試預算保持小，不要用容錯移轉重送服務無法重放的非冪等請求。健康檢查或懲罰應反映你實際使用的傳輸。

## 先量測再調校 [#measure]

分別量測操作、傳輸與消費者。過短的逾時看起來像網路失敗；過小的佇列會把突發流量變成 fault。變更 buffer、逾時或重試次數前，先使用既有的遙測 hook 與能重現負載的 fixture。
