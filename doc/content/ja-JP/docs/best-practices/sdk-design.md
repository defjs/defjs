---
title: "SDK 設計"
description: "アプリケーションのクライアントを所有せずに、契約を記述する操作、Struct、パッケージを設計します。"
---

## 定義ごとに 1 操作 [#one-operation]

操作ごとに独自の定義とモジュールを与えてください。操作には 1 つの method、1 つの path 形状、1 つの入力、1 つの出力契約があります。操作単位で分割すると契約が読みやすくなり、アプリケーションは呼び出す操作だけを import できます。

推奨:

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

定義の隣でクライアントを作成したり、エンドポイントを保持したりするモジュールは避けてください。

## 入力には明示的な builder を組み合わせる [#builder]

呼び出し側のすべての値を `input` で宣言し、`builder` で配置します。フィールド名が path パラメータと一致することに頼らないでください。`builder` は同期的で純粋です。値の形を変えることはできますが、認証情報を読んだり、ネットワークを呼んだり、共有状態を変更したりしてはいけません。

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## Struct はワイヤ上の形を記述する [#structs]

ワイヤを越えるデータには Struct を使ってください。ワイヤ名が TypeScript の名前と異なるときはエイリアスを使います。業務ルール、フィールド間の検証、正規化はアプリケーションの方針として扱い、Struct の振る舞いにはしないでください。

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## 安定した操作名を使う [#operation-name]

`operation` には `orders.read` のようなカーディナリティの低い識別子を設定します。URL、ユーザー入力、リクエストごとの値を運ばずに、テレメトリーと診断にラベルを付けます。

## SDK に実行状態を持たせない [#no-client]

SDK パッケージは定義、Struct、型を export します。`createClient` を呼んだり、シングルトンのクライアントを保持したり、環境変数を読んだりしません。エンドポイントと認証情報を決めるのはアプリケーションです。

## 契約のバージョンを意図的に管理する [#versioning]

フィールドの削除、method や path の変更、入力の狭小化は破壊的変更として扱ってください。追加は通常互換です。パッケージの peer range を正直に保ち、アプリケーションがコンパイルするのと同じ定義テキストで公開し、公開したパッケージのリリースタグを記録します。
