---
title: "Skill"
description: "Defjs skill を導入し、型付きの GET 操作をアシスタントに作成させ、導入済みの SDK と照合します。"
---

# Skill

Defjs skill は、SDK の定義とアプリケーション実行の契約をアシスタントに伝えます。対応するアシスタントは関連するタスクでこれを読み込めますが、自動的に有効になるかはツール次第です。

## skill を導入する [#install]

skill を受け取るプロジェクトで次のコマンドを実行します。CLI はデフォルトで現在のプロジェクトへ導入し、現在のエージェントを自動検出するか、選択を求めます。`-a` で明示的に指定することもできます。

```sh
bunx skills add defjs/defjs --skill defjs
```

公開後の skill の手順は [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md) で読めます。GitHub 上のソースはデフォルトブランチであり、プロジェクトにインストールされた `@defjs/core` のバージョンと一致しないことがあります。

## 操作を 1 つ依頼する [#prompt]

アシスタントにタスクを 1 つ渡します。次のプロンプトは、型付きの `GET /orders/:id` と、アプリケーション側に置くクライアントを求めます。

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 結果を確認する [#verify]

定義とアプリケーションを分けて読みます。定義は操作を export し、クライアントは作成しません。アプリケーションがクライアントを作成し、操作を呼びます。たとえば `getOrder(client, { id: 1 })` です。`input` を宣言したときは、`builder` は明示的で同期的な純粋関数です。成功値は `error` スロットが空のときだけ使用します。呼び出し側は呼び出しの直後に `if (err)` を確認してそのブロックの中から return し、失敗しうるヘルパーはログに出したり `undefined` を返したりせず、自身の `[err, value]` タプルを返します。

その後、そのプロジェクトの型チェックと、契約をカバーするテストを実行します。依存関係の導入と CI の規則はそのプロジェクトに残します。
