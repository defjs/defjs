---
title: Struct
description: struct ファサード、Infer、StructError です。
---

# Struct {#page}

ワイヤ境界の形を作り、値をパースし、TypeScript 型を推論します。

## struct {#struct}

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
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                                           |
| `struct.date()`                                                             | `Date`                                                                                         |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | コレクション                                                                                   |
| `struct.object(shape)`                                                      | オブジェクト。フィールドは `.optional()`、`.null()` / `.nullable()`、`.alias(name)` を取れます |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | ユニオン                                                                                       |
| `struct.enum(values)`                                                       | 文字列リスト、または `{ Name: value }` マップ                                                  |

### ボディコーデックとバイナリ値

| ヘルパー                                       | 役割                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | コーデックタグ付きのオブジェクト struct。タグが適用されるのは、その値がリクエストボディのルートであるときだけ |
| `struct.arrayBuffer()` / `blob()` / `file()`   | バイナリ値。ボディのルートではバイト列として送られ、`output` / `error` ではその表現を選ぶ                     |
| `struct.string()`                              | テキスト。ボディのルート、または受信側の `string` struct では、バイト列はテキストのまま                       |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **戻り値** `[null, value]`、または `[StructError, undefined]` です。
- 任意の `errorMap` は、このパースだけの issue メッセージを書き換えます。
- デフォルトは**論理**キー（`displayName`）を読みます。HTTP/JSON コーデックと同じようにワイヤキー（`display_name`）を読むには `{ aliases: true }` を渡します。

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## 型

### Infer {#Infer}

### StructInput {#StructInput}

### AnyStruct {#AnyStruct}

### ParseResult {#ParseResult}

```ts
type Infer<T> = /* output type of T */
type StructInput<T> = /* input type of T */
type AnyStruct = Struct<any, any, boolean>
type ParseResult<O> = [error: null, value: O] | [error: StructError, value: undefined]
```

### StructError {#StructError}

```ts
class StructError extends Error {
  readonly issues: StructIssue[]
  format(): FormattedStructError
  flatten(): FlattenedStructError
  prettify(): string
}
```

`StructIssue` は `path`、`code`、`expected`、`received`、`message` です。`code` は `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union`、`missing_key` のいずれかです。

[Struct ガイド](/core/struct) を見てください。

## Struct {#Struct}

パースできる形です。input/output の型に加え、`.optional()`、`.null()` / `.nullable()`、`.nullish()`、`.alias()` を持ちます。

## StructLike {#StructLike}

`_struct` の型ペイロードを持つものです。

## StructMethods {#StructMethods}

`.alias()`、`.null()` / `.nullable()`、`.nullish()`、`.optional()` です。

## ObjectStruct {#ObjectStruct}

`struct.object` が作る、オブジェクト形の struct です。

## StructIssue {#StructIssue}

`path`、`code`、`expected`、`received`、`message` です。`code` は `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union`、`missing_key` のいずれかです。

## FormattedStructError {#FormattedStructError}

`StructError.format()` が出す、入れ子の `{ _errors, [key]: … }` の木です。

## FlattenedStructError {#FlattenedStructError}

`StructError.flatten()` が出す `formErrors` と `fieldErrors` です。
