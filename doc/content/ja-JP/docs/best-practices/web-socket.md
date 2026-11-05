---
title: "WebSocket"
description: "セッションを所有し、受信キューを読み、両方のキューを制限し、ランタイムエラーと再接続を処理します。"
---

## セッションを所有する [#ownership]

WebSocket セッションは、それを開いた呼び出し側のものです。作業が終わったら閉じ、周囲のスコープが所有するときは `await using` を使って、どの終了経路でもセッションが破棄されるようにします。

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## セッションが閉じるまで読む [#read-to-end]

セッションが閉じるか呼び出し側が止めるまで、`session.receive` を読みます。最初のメッセージを最後だと仮定しないでください。セッションが開いたあとに起きるトランスポート失敗をアプリケーションが観測する必要があるときは、`onRuntimeError` を登録します。

## 両方のキューを制限する [#bounds]

消費者を待つメッセージには `maxIncomingQueueSize`、再接続中にキューされるメッセージには `maxOutgoingQueueSize` を設定します。上限は、遅い消費者や長い再接続を無制限のメモリ増加ではなくフォールトに変えます。オーバーフローの経路は、本番と同じ上限でテストしてください。

## 再接続とハートビートを意図的にする [#reconnect]

再接続とハートビートはクライアント options です。再接続は新しい接続試行を作り、キューされた送信メッセージはキューの方針に従います。確認を受け取らないハートビートはアプリケーションが分類すべき失敗であり、永遠に送り続ける理由ではありません。

## 閉じる、漏らさない [#close]

`close()` は teardown を開始し、`closed` は終端状態を報告します。セッションが書き込み可能でなくなったあとの send は throw するので、状態を確認するか throw を処理してください。次のステップがトランスポートの解放に依存するときは、`closed` を待ちます。
