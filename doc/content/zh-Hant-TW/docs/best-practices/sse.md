---
title: "SSE"
description: "自己擁有事件串流 handle、讀到結束、為 buffer 設上限，並明確決定重連策略。"
---

## 自己擁有 handle [#ownership]

事件串流屬於開啟它的呼叫端。工作完成時關閉它；周圍的作用域擁有它時，用 `await using`，讓 handle 在每一條離開路徑上都被釋放。

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 讀到完成或 EOF [#read-to-end]

一個事件不構成完整的回應。持續讀取，直到串流結束、呼叫端 abort，或重連策略接手。把讀取失敗當成傳輸失敗，而不是乾淨的結束。

## 為 buffer 與 queue 設上限 [#bounds]

依訊息大小與消費者的速度設定 `maxBufferSize` 與 `maxQueueSize`。設上限能把慢速消費者變成 fault，而不是無界的記憶體成長。用與正式環境相同的上限測試 overflow 路徑。

## 明確決定重連策略 [#reconnect]

SSE 重連預設關閉，直到應用程式啟用。像 POST 這類非冪等方法，除非策略允許，否則不會重放。失敗的嘗試可能已經在伺服器上開始工作；啟用策略前，先讀 [SSE 事件串流](/zh-Hant-TW/docs/sse) 的重連規則。

## 關閉，不要外洩 [#close]

`close()` 啟動拆除；`closed` 回報終端狀態。下一步取決於傳輸已釋放時，請等待 `closed`。Abort 結束的是本機工作；它不能證明服務已停止它早先接受的工作。
