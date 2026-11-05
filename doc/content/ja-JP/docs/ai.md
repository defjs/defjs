---
title: "Skill"
description: "Defjs の skill を導入し、型付き GET エンドポイントを助手に作らせ、導入済み SDK と照合します。"
---

Defjs skill は、SDK の定義とアプリケーションでの実行の契約をアシスタントに伝えます。対応するアシスタントは関連するタスクでこれを読み込めますが、自動的に有効になるかはツール次第です。

## skill を導入する [#install]

Skill を使うプロジェクトで次のコマンドを実行します。CLI は既定で現在のプロジェクトへ導入し、現在のエージェントを自動検出するか、選択を求めます。`-a` で明示的に指定することもできます。

```sh
bunx skills add defjs/defjs --skill defjs
```

公開後の skill の手順は [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md) で読めます。GitHub 上のソースはデフォルトブランチであり、プロジェクトに入っている `@defjs/core` の版と一致しないことがあります。

## エンドポイントを一つ頼む [#prompt]

助手には作業を一つ渡します。次のプロンプトは、型付きの `GET /orders/:id` と、アプリケーション側に置く client を求めます。

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 結果を確認する [#verify]

定義とアプリケーションを分けて読みます。定義は操作をエクスポートし、client は作りません。アプリケーションが client を作り、操作を呼びます。たとえば `getOrder(client, { id: 1 })` です。`input` を宣言したときは、`builder` は明示的な同期的純粋関数です。成功値を使うのは error の枠が空のときだけです。

その後、そのプロジェクト自身の型チェックと、その契約を実際に実行するテストを走らせます。依存関係の導入と CI の規則はそのプロジェクトに残します。
