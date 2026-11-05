---
title: "WebSocket"
description: "自己擁有 session、讀取 receive queue、為兩個 queue 設上限，同處理 runtime error 同重連。"
---

## 自己擁有 session [#ownership]

WebSocket session 屬於開啟佢嘅呼叫方。工作完成就 close 佢；如果周圍嘅 scope 擁有佢，就用 `await using`，確保每一條離開路徑都會 dispose 個 session。

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## 讀到 session 關閉為止 [#read-to-end]

一直讀 `session.receive`，直到 session 關閉或者呼叫方停低。唔好假定第一條訊息就係最後一條。應用程式要觀察 session 開啟之後發生嘅 transport failure，就註冊 `onRuntimeError`。

## 為兩個 queue 設上限 [#bounds]

為等 consumer 讀嘅訊息設定 `maxIncomingQueueSize`，為重連期間排隊嘅訊息設定 `maxOutgoingQueueSize`。有上限，慢 consumer 或者長時間重連會變成一個 fault，而唔係無上限嘅記憶體增長。用 production 相同嘅限制去測試 overflow 路徑。

## 刻意設定重連同心跳 [#reconnect]

重連同心跳都係 client option。重連會建立一次新嘅連線嘗試；排隊嘅 outgoing 訊息跟 queue 政策。心跳收唔到確認就係一個失敗，要由應用程式分類，而唔係繼續無限咁送落去。

## 關閉，唔好漏 [#close]

`close()` 開始 teardown；`closed` 報告終態。Session 唔再 writable 之後再 send 會 throw；檢查 state 或者處理個 throw。下一步要等 transport 釋放嘅話，就等 `closed`。
