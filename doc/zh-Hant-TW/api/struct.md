---
title: Struct
description: struct facade、Infer，以及 StructError。
---

# Struct {#page}

組 wire 邊界的形狀、剖析值、推導 TypeScript 型別。

## struct {#struct}

Facade。請走這個，別用內部 constructors。

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### 純量與容器

| Helper                                                                      | 用途                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | 純量                                                                    |
| `struct.literal(value)`                                                     | 精確字面值                                                              |
| `struct.null()` / `any()` / `unknown()`                                     | Null／any／unknown                                                      |
| `struct.date()`                                                             | `Date`                                                                  |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | 集合                                                                    |
| `struct.object(shape)`                                                      | 物件；欄位可接 `.optional()`、`.null()` / `.nullable()`、`.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | 聯集                                                                    |
| `struct.enum(values)`                                                       | 字串清單或 `{ Name: value }` map                                        |

### Body codecs 與二進位值

| Helper                                         | 用途                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | 物件 struct 加上 codec tag。只有該值是 request body 根時，tag 才生效              |
| `struct.arrayBuffer()` / `blob()` / `file()`   | 二進位值。當 body 根時以 bytes 送出；當 `output`／`error` 時選那個 representation |
| `struct.string()`                              | 文字。當 body 根，或當入站的 `string` struct 時，bytes 維持文字                   |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **回傳** `[null, value]` 或 `[StructError, undefined]`。
- 選填的 `errorMap` 只改這一次 parse 的 issue 文案。
- 預設讀**邏輯** keys（`displayName`）。傳 `{ aliases: true }` 會讀 wire keys（`display_name`），跟 HTTP／JSON codecs 一樣。

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## 型別

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

`StructIssue`：`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

見 [Struct 指南](/core/struct)。

## Struct {#Struct}

能 parse 的形狀：input／output 型別，加上 `.optional()`、`.null()`／`.nullable()`、`.nullish()`、`.alias()`。

## StructLike {#StructLike}

帶 `_struct` 型別載荷的東西。

## StructMethods {#StructMethods}

`.alias()`、`.null()`／`.nullable()`、`.nullish()`、`.optional()`。

## ObjectStruct {#ObjectStruct}

`struct.object` 做出來的物件形狀。

## StructIssue {#StructIssue}

`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

## FormattedStructError {#FormattedStructError}

`StructError.format()` 吐出的巢狀 `{ _errors, [key]: … }`。

## FlattenedStructError {#FlattenedStructError}

`StructError.flatten()` 吐出的 `formErrors` 加 `fieldErrors`。
