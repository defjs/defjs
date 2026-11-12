---
title: Struct
description: struct ファサード、Infer、StructError です。
---

# Struct

ワイヤ境界の形を作り、値をパースし、TypeScript 型を推論します。

## struct

ファサードです。内部コンストラクタよりこちらを使ってください。

<include cwd lang="typescript">
  examples/api/struct.ts#example
</include>

### プリミティブとコンテナ

| ヘルパー                                                                    | 役割                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | スカラー                                                                                       |
| `struct.literal(value)`                                                     | ちょうどそのリテラル                                                                           |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown。`any()` と `unknown()` は `null` と `undefined` を拒否します             |
| `struct.date()`                                                             | `Date`                                                                                         |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | コレクション。`tuple` は配列を 1 つ取ります: `struct.tuple([a, b])`                            |
| `struct.object(shape)`                                                      | オブジェクト。フィールドは `.optional()`、`.null()` / `.nullable()`、`.alias(name)` を取れます |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | ユニオン                                                                                       |
| `struct.enum(values)`                                                       | 文字列リスト、または `{ Name: value }` マップ。マップが受け付けるのは値で、キーではありません  |

### ボディコーデックとバイナリ値

| ヘルパー                                       | 役割                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | コーデックタグ付きのオブジェクト struct。タグが適用されるのは、その値がリクエストボディのルートであるときだけ                                                                                              |
| `struct.arrayBuffer()` / `blob()` / `file()`   | バイナリ値。ボディのルートではバイト列として送られ、`output` / `error` ではその表現を選ぶ                                                                                                                  |
| `struct.string()`                              | テキスト。HTTP または SSE のボディのルート、および HTTP/SSE の受信データでは、バイト列はテキストのままです。WebSocket の受信フレームは先に JSON パースされるので、string struct は JSON 文字列を期待します |

### struct.parse()

<ApiSignature name="struct.parse" />

- **戻り値** `[null, value]`、または `[StructError, undefined]` です。エラーが持つ issue は 1 つです。オブジェクトのフィールドは最初の不正なフィールドで止まります。`struct.or` はすべての分岐を試したあと `invalid_union` を報告し、最初の分岐の失敗は残しません。
- オブジェクトのフィールドは、`.optional()` か `.nullish()` を付けない限り必須です。shape が宣言していないキーは、結果から落とされます。
- 任意の `options.errorMap` は、このパースだけの issue メッセージを書き換えます。
- デフォルトは**論理**キー（`customerName`）を読みます。HTTP/JSON コーデックと同じようにワイヤキー（`customer_name`）を読むには `{ aliases: true }` を渡します。

## ErrorMap

<ApiSignature name="ErrorMap" />

## 型

### Infer

### StructInput

### AnyStruct

### ParseResult

<ApiSignature name="Infer, StructInput, AnyStruct, ParseResult" />

### StructError

<ApiSignature name="StructError" />

`StructIssue` は `path`、`code`、`expected`、`received`、`message` です。`code` は `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union`、`missing_key` のいずれかです。

[Struct ガイド](/ja-JP/docs/struct) を見てください。

## STRUCT

操作の入力からパースされたオブジェクトに付く `unique symbol` です。アウトバウンドのエンコーダー内部のものであり、型としてのみ export されています。読んだり設定したりしないでください。

## Struct

パースできる形です。input/output の型に加え、`.optional()`、`.null()` / `.nullable()`、`.nullish()`、`.alias()` を持ちます。

## StructLike

`_struct` の型ペイロードを持つものです。[`StructLike`](/ja-JP/api/core/structlike-type) を見てください。

## StructMethods

`.alias()`、`.null()` / `.nullable()`、`.nullish()`、`.optional()` です。

## StringStruct

`struct.string` が作る、文字列の struct です。

## NumberStruct

`struct.number` が作る、数値の struct です。

## UnknownStruct

`struct.unknown` が作る、unknown の struct です。

## ObjectStruct

`struct.object` が作る、オブジェクト形の struct です。

## ArrayStruct

`struct.array` が作る、配列の struct です。

## RecordStruct

`struct.record` が作る、レコードの struct です。

## TupleStruct

`struct.tuple` が作る、タプルの struct です。

## UnionStruct

`struct.or` が作る、ユニオンの struct です。

## DiscriminatedUnionStruct

`struct.discriminatedUnion` が作る、判別ユニオンの struct です。

## IntersectionStruct

`struct.intersection` が作る、交差の struct です。

## PreservedStruct

複合 struct に `.optional()` や `.nullable()` などの修飾子を使ったときに返る struct です。元の複合 struct の型を保ちます。

## StructIssue

`path`、`code`、`expected`、`received`、`message` です。`code` は `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union`、`missing_key` のいずれかです。

## FormattedStructError

`StructError.format()` が出す、入れ子の `{ _errors, [key]: … }` ツリーです。

## FlattenedStructError

`StructError.flatten()` が出す `formErrors` と `fieldErrors` です。
