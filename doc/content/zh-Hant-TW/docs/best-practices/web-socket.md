---
title: "WebSocket"
description: "自己擁有工作階段、讀取接收佇列、為兩個佇列設上限，並處理執行期錯誤與重連。"
---

## 自己擁有工作階段 [#ownership]

WebSocket 工作階段屬於開啟它的呼叫端。工作完成時關閉它；周圍的作用域擁有它時，用 `await using`，讓工作階段在每一條離開路徑上都被釋放。

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## 讀到工作階段關閉 [#read-to-end]

持續讀取 `session.receive`，直到工作階段關閉或呼叫端停止。不要假設第一則訊息就是最後一則。應用程式必須觀察工作階段開啟後才發生的傳輸失敗時，請註冊 `onRuntimeError`。

## 為兩個佇列設上限 [#bounds]

為等待消費者的訊息設定 `maxIncomingQueueSize`，為重連期間排隊的訊息設定 `maxOutgoingQueueSize`。設上限能把慢速消費者或漫長的重連變成 fault，而不是無界的記憶體成長。用與正式環境相同的上限測試 overflow 路徑。

## 讓重連與 heartbeat 有明確依據 [#reconnect]

重連與 heartbeat 都是 client options。重連會建立一次新的連線嘗試；排隊的 outgoing 訊息依佇列策略處理。收不到確認的 heartbeat 是應用程式必須分類的失敗，而不是一直送下去的藉口。

## 關閉，不要外洩 [#close]

`close()` 啟動拆除；`closed` 回報終端狀態。工作階段不再可寫之後送出會丟出例外；請檢查狀態或處理這個例外。下一步取決於傳輸已釋放時，請等待 `closed`。
