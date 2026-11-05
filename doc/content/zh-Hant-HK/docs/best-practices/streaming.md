---
title: "串流與即時"
description: "自己擁有 stream handle，為 queue 設上限，重連同重播政策喺應用程式決定。"
---

## 擁有個 handle [#ownership]

event stream 或者 WebSocket session 屬於開啟佢嘅呼叫方。工作做完就關閉佢；如果外面嗰個 scope 擁有佢，就用 `await using`，令 handle 喺每一條離開嘅路徑上都會 dispose。

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 讀到完結或者 EOF [#read-to-end]

一個 event 唔等於成個 response。SSE 要一路讀到 stream 完結、呼叫方 abort，或者由重連政策接手。WebSocket 就要讀 receive queue，直到 session 關閉或者呼叫方停低。

## 為 buffer 同 queue 設上限 [#bounds]

WebSocket session 要設 `maxIncomingQueueSize`，SSE 要設 `maxBufferSize` / `maxQueueSize`。有咗上限，慢嘅 consumer 就會變成一個 fault，而唔係無止境咁食記憶體。上限按訊息大小同 consumer 嘅速度揀，之後要測試 overflow 嗰條路徑。

## 明確決定重連同重播 [#reconnect]

SSE 重連預設係關嘅，要應用程式開啟先會生效。POST 或者其他非 idempotent method 唔會重播，除非政策准許。失敗咗嘅 streaming 嘗試，可能已經喺 server 開始做嘢；開政策之前，先讀 [SSE 事件流](/zh-Hant-HK/docs/sse) 嘅重連規則，同 [HTTP 請求](/zh-Hant-HK/docs/http) 嘅重播規則。

## 關閉，唔好漏 [#close]

`close()` 開始拆解；`closed` 報告終態。如果下一步要靠個 transport 已經釋放，就要等 `closed`。abort 只係結束本地工作；佢唔證明服務停咗佢已經接收嘅工作。
