---
title: "串流與即時"
description: "讓應用程式擁有串流 handle、為佇列設上限，並決定重連與重放策略。"
---

## 擁有 handle [#ownership]

事件串流或 WebSocket 工作階段屬於開啟它的呼叫端。工作完成時關閉它；外圍作用域擁有它時使用 `await using`，讓 handle 在每個離開路徑都被釋放。

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 讀到完成或 EOF [#read-to-end]

一個事件不是完整的回應。對 SSE，持續讀到串流結束、呼叫端中止，或重連策略接手。對 WebSocket，讀取接收佇列直到工作階段關閉或呼叫端停止。

## 為緩衝區與佇列設上限 [#bounds]

為 WebSocket 工作階段設定 `maxIncomingQueueSize`，為 SSE 設定 `maxBufferSize` / `maxQueueSize`。加上限能把慢速消費者變成 fault，而不是無界成長的記憶體。依據訊息大小與消費者速度選擇上限，並測試溢位路徑。

## 明確決定重連與重放 [#reconnect]

SSE 重連在應用程式啟用前是關閉的。除非策略允許，POST 或其他非冪等方法不會重放。串流嘗試失敗時，伺服器可能已經開始工作；啟用策略之前，先讀 [SSE 事件串流](/zh-Hant-TW/docs/sse) 的重連規則與 [HTTP 請求](/zh-Hant-TW/docs/http) 的重放規則。

## 關閉，別洩漏 [#close]

`close()` 啟動拆除；`closed` 回報終端狀態。下一步取決於傳輸是否已釋放時，等待 `closed`。abort 只結束本機工作；它不能證明服務已停止它先前接受的工作。
