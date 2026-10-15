---
title: Struct
description: struct ファサード、Infer、StructError です。
---

# Struct

ワイヤ境界の形を作り、値をパースし、TypeScript 型を推論します。

## struct

ファサードです。内部コンストラクタよりこちらを使ってください。

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

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

| ヘルパー                                       | 役割                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | コーデックタグ付きのオブジェクト struct。タグが適用されるのは、その値がリクエストボディのルートであるときだけ |
| `struct.arrayBuffer()` / `blob()` / `file()`   | バイナリ値。ボディのルートではバイト列として送られ、`output` / `error` ではその表現を選ぶ                     |
| `struct.string()`                              | テキスト。ボディのルート、または受信側の `string` struct では、バイト列はテキストのまま                       |

### struct.parse()

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **戻り値** `[null, value]`、または `[StructError, undefined]` です。パースは最初の失敗で止まるので、エラーが持つ issue は 1 つです。
- オブジェクトのフィールドは、`.optional()` か `.nullish()` を付けない限り必須です。shape が宣言していないキーは、結果から落とされます。
- 任意の `errorMap` は、このパースだけの issue メッセージを書き換えます。
- デフォルトは**論理**キー（`displayName`）を読みます。HTTP/JSON コーデックと同じようにワイヤキー（`display_name`）を読むには `{ aliases: true }` を渡します。

## ErrorMap

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## 型

### Infer

### StructInput

### AnyStruct

### ParseResult

```ts
type Infer<T> = /* output type of T */
type StructInput<T> = /* input type of T */
type AnyStruct = Struct<any, any, boolean>
type ParseResult<O> = [error: null, value: O] | [error: StructError, value: undefined]
```

### StructError

```ts
class StructError extends Error {
  readonly issues: StructIssue[]
  format(): FormattedStructError
  flatten(): FlattenedStructError
  prettify(): string
}
```

`StructIssue` は `path`、`code`、`expected`、`received`、`message` です。`code` は `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union`、`missing_key` のいずれかです。

[Struct ガイド](/ja-JP/docs/struct) を見てください。

## STRUCT

エンドポイントの入力からパースされたオブジェクトに付く `unique symbol` です。アウトバウンドのエンコーダー内部のものであり、型としてのみ export されています。読んだり設定したりしないでください。

## Struct

パースできる形です。input/output の型に加え、`.optional()`、`.null()` / `.nullable()`、`.nullish()`、`.alias()` を持ちます。

## StructLike

`_struct` の型ペイロードを持つものです。[`StructLike`](/ja-JP/api/core/structlike-type) を見てください。

## StructMethods

`.alias()`、`.null()` / `.nullable()`、`.nullish()`、`.optional()` です。

## ObjectStruct

`struct.object` が作る、オブジェクト形の struct です。

## StructIssue

`path`、`code`、`expected`、`received`、`message` です。`code` は `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union`、`missing_key` のいずれかです。

## FormattedStructError

`StructError.format()` が出す、入れ子の `{ _errors, [key]: … }` の木です。

## FlattenedStructError

`StructError.flatten()` が出す `formErrors` と `fieldErrors` です。
