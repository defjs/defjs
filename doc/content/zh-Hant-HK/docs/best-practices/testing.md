---
title: "測試"
description: "用注入嘅 transport、真實 tuple 同受控時間，測試定義嘅契約。"
---

## 注入 transport [#inject]

用 `withHTTPHandle`、`withSSEHandle` 或者 `withWebSocketHandle` 換走平台嘅 transport。操作照樣會 build request、行 interceptors、解碼 response，所以測試行到真正嘅契約邊界。

```ts
const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
const [error, order] = await getOrder(client, { id: 7 });
expect(error).toBeNull();
expect(order?.status).toBe("paid");
```

## 斷言 tuple，唔係內部實作 [#tuple]

檢查 fault code 同已解碼嘅值。如果測試斷言私有 helper 嘅呼叫，或者 transport 嘅實作細節，實作一改但契約冇變，個測試就會爛。測 fault 嘅時候，斷言 `code`、相關 field，同埋（當 cause 屬於契約一部分時）`cause` 嘅身分。

## 契約 fixture 要真實 [#fixtures]

如果改動牽涉 request building、解碼，或者 stream teardown，就為每種 transport 對住真 server 跑一個 integration test。用 repo 已經有嘅 fixture server，唔好另開第二套 mock protocol。只喺瀏覽器出現嘅行為放喺 browser project；只喺 server 出現嘅行為放喺 server project。

## 明確控制時間 [#time]

timeout、backoff、重連延遲同 heartbeat 都用 fake timers。等被測事件發生咗先推進時間，然後斷言應該行過嘅 code path。永遠唔好斷言實際流逝嘅時間。真 socket 就等具體事件，例如 `open`、`closed`，或者第一格 frame。

## 以使用方身分測試 SDK [#consumer]

SDK 測試應該匯入應用程式匯入嘅定義，用 test transport 建立 client，再呼叫操作。唔好自己手動重砌個 request；咁樣測到嘅係個測試，唔係 SDK。
