---
title: "AI を活用した開発"
description: "Defjs の skill を導入し、型付き GET エンドポイントを助手に作らせ、導入済み SDK と照合します。"
---

助手に Defjs のコードを書かせることと、アプリケーションから AI サービスを呼ぶことは別の作業です。このページは助手の作業手順です。[AI API の呼び出し](/ja-JP/docs/ai-api) はアプリケーション側の手順です。対応するアシスタントは関連する作業で Skill を読み込めます。自動的に読み込むかどうかはツールによって異なります。

## skill を導入する [#install]

skills CLI には Node.js 22.20 以降が必要です。これはインストーラの要件であり、`@defjs/core` の実行環境ではありません。実行環境は[クイックスタート](/ja-JP/docs/start)を参照してください。

Skill を使うプロジェクトで次のコマンドを実行します。CLI は既定で現在のプロジェクトへ導入し、現在のエージェントを自動検出するか、選択を求めます。`-a` で明示的に指定することもできます。

```sh
npx skills add defjs/defjs --skill defjs
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

## 助手向けの英語 Markdown [#resources]

このサイトのガイド、実践例、API 概要は人向けで、各ロケールに本文があります。次の三つのアドレスは英語ページだけから生成されます。ロケール接頭辞は付かず、今読んでいるページの翻訳でもありません。

- [英語ページの索引](/llms.txt) は英語ページを一覧にし、それぞれのウェブページへリンクします。
- [英語ガイドの編纂版](/llms-full.txt) はそれらのページを一つのファイルにまとめます。
- [クイックスタートの Markdown](/llms.mdx/docs/start/content.md) は一ページ分の英語本文です。他の英語ページも `/llms.mdx/…/content.md` と同じ形です。

このロケールのガイドを読むときは[クイックスタート](/ja-JP/docs/start)を開きます。助手に API を合わせるときは Markdown アドレスを渡します。助手は、プロジェクトに入っている `@defjs/core` の版に従います。このサイトの文書はインストール済みの版と異なる場合があるため、その版の API を確認してください。文書の GitHub ソースもデフォルトブランチであり、インストール済みの版と異なることがあります。コードやコンテキストを AI ツールに渡す前に、秘密情報を取り除き、プロジェクトのデータ利用方針を確認してください。
