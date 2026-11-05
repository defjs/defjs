---
title: "SSE"
description: "自己擁有 event stream handle、讀到完為止、為 buffer 設上限，同明確決定重連政策。"
---

## 自己擁有 handle [#ownership]

Event stream 屬於開啟佢嘅呼叫方。工作完成就 close 佢；如果周圍嘅 scope 擁有佢，就用 `await using`，確保每一條離開路徑都會 dispose 個 handle。

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 讀到完或者 EOF [#read-to-end]

一個 event 唔等於完整嘅 response。要一直讀到 stream 結束、呼叫方 abort，或者重連政策接手為止。讀取失敗要當成 transport failure 處理，唔好當係乾淨結束。

## 為 buffer 同 queue 設上限 [#bounds]

按訊息大細同 consumer 嘅速度設定 `maxBufferSize` 同 `maxQueueSize`。有上限，慢 consumer 會變成一個 fault，而唔係無上限嘅記憶體增長。用 production 相同嘅限制去測試 overflow 路徑。

## 明確決定重連政策 [#reconnect]

SSE 重連預設關閉，要應用程式自己開啟。POST 呢類非冪等 method 唔會重播，除非政策允許。失敗嘅嘗試可能已經喺 server 開始咗工作；開啟政策之前，先睇 [SSE 事件流](/zh-Hant-HK/docs/sse) 嘅重連規則。

## 關閉，唔好漏 [#close]

`close()` 開始 teardown；`closed` 報告終態。下一步要等 transport 釋放嘅話，就等 `closed`。Abort 只係結束本地工作；佢唔證明服務已停止佢已經接受咗嘅工作。
