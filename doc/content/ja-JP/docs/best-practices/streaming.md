---
title: "ストリーミングとリアルタイム"
description: "ストリームのハンドルを所有し、キューに上限を設け、再接続と再送の方針をアプリケーションで決めます。"
---

## ハンドルを所有する [#ownership]

イベントストリームや WebSocket セッションは、それを開いた呼び出し側に属します。作業が終わったら閉じてください。周囲のスコープが所有する場合は `await using` を使い、どの終了経路でもハンドルが破棄されるようにします。

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 完了か EOF まで読む [#read-to-end]

1 つのイベントは完全なレスポンスではありません。SSE では、ストリームが終わるか、呼び出し側が abort するか、再接続方針が引き継ぐまで読み続けてください。WebSocket では、セッションが閉じるか呼び出し側が止めるまで、受信キューを読みます。

## バッファとキューに上限を設ける [#bounds]

WebSocket セッションには `maxIncomingQueueSize`、SSE には `maxBufferSize` / `maxQueueSize` を設定します。上限は、遅い消費者を無制限のメモリ増加ではなくフォールトに変えます。メッセージサイズと消費者の速度から上限を選び、オーバーフローの経路をテストしてください。

## 再接続と再送を明示的に決める [#reconnect]

SSE の再接続は、アプリケーションが有効にするまでオフです。POST などの非冪等な method は、方針が許可しない限り再送されません。失敗したストリーミングの試行は、すでにサーバーで作業を開始しているかもしれません。方針を有効にする前に、[SSE イベントストリーム](/ja-JP/docs/sse)の再接続の規則と、[HTTP リクエスト](/ja-JP/docs/http)の再送の規則を読んでください。

## 閉じる。漏らさない [#close]

`close()` は破棄を開始し、`closed` は終端状態を報告します。次の手順がトランスポートの解放に依存するなら、`closed` を待ってください。abort はローカルの作業を終えますが、サービスがすでに受け入れた作業を止めた証明にはなりません。
