---
title: "エラー処理"
description: "呼び出し地点でフォールトを読み、code で絞り込み、ログとリトライを定義の外に置きます。"
---

## 値より先にフォールトを読む [#fault-first]

すべての操作は `[error, data, response]` を返します。成功値が意味を持つのは、最初の要素が `null` のときだけです。

推奨:

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

避ける:

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // order is undefined when the call failed
```

## code で絞り込み、次にデータで絞り込む [#narrow]

`fault.code` が失敗の類別を選びます。`HTTP_STATUS` では `status`、デコードされたエラーボディには `data`、メタデータには `response` を読みます。`cause` は下位のパーサーやトランスポートの失敗を保持します。一般的なメッセージで置き換えないでください。

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

`RES_*` は、レスポンスを宣言どおりに読めなかったことを意味します。`NET_*` は、リクエストが使えるレスポンスを生まなかったことを意味します。デコードや契約の失敗を、ネットワーク失敗のようにリトライしないでください。

## 結果を所有する境界で一度だけログを出す [#logging]

次に何が起きるかを決める層でログを出してください。リクエストハンドラー、ジョブランナー、UI の境界です。テレメトリーには OpenTelemetry プラグインかインターセプターを使い、定義にはログを入れません。URL、query 文字列、headers、body はログに届く前に秘匿化してください。

## 再送しても安全なものだけリトライする [#retry]

Defjs は HTTP を自動でリトライしません。リトライはアプリケーションか、明示的なエンドポイントフェイルオーバー方針に属します。安全な method、またはサービスが冪等と明記している操作をリトライしてください。課金される作業を開始した可能性のある POST は、再送の契約なしに繰り返すのは安全ではありません。

## 飲み込まない [#no-swallow]

エラーのあとに成功を返すと、壊れた契約が隠れます。フォールトをアプリケーションの結果に写像するか、プログラミングエラーを再 throw するか、型付きの失敗で操作を終えてください。ログを出すためだけにフォールトを catch し、`undefined` の値で続行してはいけません。
