---
title: "アプリケーション統合"
description: "クライアントはアプリケーションの境界で作成し、認証情報、方針、フレームワーク連携を SDK の外に置きます。"
---

## 境界でクライアントを一度だけ作成する [#client-boundary]

アプリケーションが設定を読む場所でクライアントを作成してください。サーバーのエントリーポイント、デプロイを所有するモジュール、テストのセットアップなどです。そのクライアントを、操作を呼び出すコードに渡します。

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

SDK の内部、コンポーネントの本体、リクエストハンドラーでモジュールレベルのクライアントを作るのは避けてください。レンダーごとやリクエストごとに作成したクライアントは、共有設定を失い、テストを周囲の状態に依存させます。

## 横断的な方針はインターセプターに置く [#interceptors]

認証、トレーシング、デフォルトヘッダー、レビュー済みのリトライ方針はインターセプターに属します。`builder` は現在の入力を配置するだけで、認証情報やアプリケーションのテレメトリーを知りません。

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## 1 回の呼び出しにはクライアント options を使う [#per-call]

`client(options)` は 1 回の呼び出し用のクライアント値を返します。その値は呼び出せません。シグナル、進捗コールバック、その呼び出しにだけ適用する WebSocket のフックに使い、それ以外は基底のクライアントを使います。

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## フレームワークプラグインにクライアントを渡させる [#plugins]

`@defjs/react` と `@defjs/vue` はアプリケーションのクライアントをフレームワークのツリーに渡します。作成、キャッシュ、リトライ、破棄はしません。アプリケーションがすでに所有しているクライアントを渡し、必要な場所に同じ値を注入してください。

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## エンドポイントを SDK の外に置く [#endpoint]

同じ定義を production、staging、ローカルのフィクスチャ、テスト用トランスポートに対して実行できます。エンドポイントはアプリケーションで選び、デプロイ先のホストを SDK パッケージに埋め込まないでください。
