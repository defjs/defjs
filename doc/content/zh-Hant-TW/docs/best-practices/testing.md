---
title: "測試"
description: "用注入的傳輸、真實的 tuple 與受控的時間，測試定義契約。"
---

## 注入傳輸 [#inject]

用 `withHTTPHandle`、`withSSEHandle` 或 `withWebSocketHandle` 取代平台傳輸。操作仍會建構請求、執行 interceptors 並解碼回應，因此測試演練的是真實的契約邊界。

```ts
const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
const [error, order] = await getOrder(client, { id: 7 });
expect(error).toBeNull();
expect(order?.status).toBe("paid");
```

## 斷言 tuple，而不是內部實作 [#tuple]

檢查 fault code 與解碼後的值。斷言私有 helper 呼叫或傳輸實作細節的測試，會在實作改變而契約未變時破裂。對 fault，斷言 `code`、相關欄位，以及 cause 屬於契約一部分時的 `cause` 身分。

## 讓契約 fixture 保持真實 [#fixtures]

當變更涉及請求建構、解碼或串流拆除時，為每種傳輸各跑一個對真實伺服器的整合測試。使用儲存庫既有的 fixture 伺服器，不要另建第二套 mock 協定。僅限瀏覽器的行為放在瀏覽器專案；僅限伺服器的行為放在伺服器專案。

## 明確控制時間 [#time]

對逾時、backoff、重連延遲與 heartbeat 使用 fake timers。在受測事件發生後才推進時間，並斷言應該執行的程式路徑。絕不斷言實際經過的牆鐘時間。對真實 socket，等待具體事件，例如 `open`、`closed` 或第一個 frame。

## 以消費者身分測試 SDK [#consumer]

SDK 測試應匯入應用程式匯入的定義，用測試傳輸建立 client，然後呼叫操作。它不應手動重建請求；那是在測試測試，不是測試 SDK。
