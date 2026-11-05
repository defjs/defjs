---
title: "SSE"
description: "イベントストリームのハンドルを所有し、最後まで読み、バッファを制限し、再接続方針を明示的に決めます。"
---

## ハンドルを所有する [#ownership]

イベントストリームは、それを開いた呼び出し側のものです。作業が終わったら閉じ、周囲のスコープが所有するときは `await using` を使って、どの終了経路でもハンドルが破棄されるようにします。

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 完了か EOF まで読む [#read-to-end]

イベント 1 つは完全なレスポンスではありません。ストリームが終わる、呼び出し側が abort する、再接続方針が引き継ぐまで読み続けます。読み取り失敗はクリーンな終了ではなく、トランスポート失敗として扱います。

## バッファとキューを制限する [#bounds]

`maxBufferSize` と `maxQueueSize` は、メッセージサイズと消費者の速度から設定します。上限は、遅い消費者を無制限のメモリ増加ではなくフォールトに変えます。オーバーフローの経路は、本番と同じ上限でテストしてください。

## 再接続方針を明示的に決める [#reconnect]

SSE の再接続は、アプリケーションが有効にするまでオフです。POST のような非冪等のメソッドは、方針が許可しない限り再送されません。失敗した試行は、すでにサーバーで作業を始めているかもしれません。方針を有効にする前に、[SSE イベントストリーム](/ja-JP/docs/sse)の再接続の規則を読んでください。

## 閉じる、漏らさない [#close]

`close()` は teardown を開始し、`closed` は終端状態を報告します。次のステップがトランスポートの解放に依存するときは、`closed` を待ちます。abort はローカルの作業を終えますが、サービスがすでに受け付けた作業を止めた証明ではありません。
