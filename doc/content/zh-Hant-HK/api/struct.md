---
title: Struct
description: struct facade、Infer，同 StructError。
---

# Struct

Build wire-boundary shapes，parse values，再 infer TypeScript types。

## struct

Facade。Prefer 用呢個，唔好用 internal constructors。

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### Primitives 同 containers

| Helper                                                                      | 做咩                                                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Scalars                                                                      |
| `struct.literal(value)`                                                     | Exact literal                                                                |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown。`any()` 同 `unknown()` 會拒絕 `null` 同 `undefined`    |
| `struct.date()`                                                             | `Date`                                                                       |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | Collections。`tuple` 收一個 array：`struct.tuple([a, b])`                    |
| `struct.object(shape)`                                                      | Object；fields 接受 `.optional()`、`.null()` / `.nullable()`、`.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                       |
| `struct.enum(values)`                                                       | String list 或者 `{ Name: value }` map；map 接受佢嘅 values，唔係 keys       |

### Body codecs 同 binary values

| Helper                                         | 做咩                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `struct.formData(shape)` / `urlencoded(shape)` | Object struct 再加一個 codec tag。個 tag 只會喺個 value 係 request body root 嘅時候先生效        |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Binary values。作為 body root 會當 bytes 送出；作為 `output` / `error` 就會揀嗰種 representation |
| `struct.string()`                              | Text。作為 body root 或者 inbound `string` struct，bytes 會保持係 text                           |

### struct.parse()

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Returns** `[null, value]` 或者 `[StructError, undefined]`。Parse 遇到第一個失敗就停，所以 error 只帶一個 issue。
- Object fields 必填，除非標記咗 `.optional()` 或者 `.nullish()`。Shape 冇聲明嘅 keys 會喺結果中被丟棄。
- 可選 `errorMap` 只會改寫呢次 parse 嘅 issue messages。
- Default 讀 **logical** keys（`displayName`）。傳 `{ aliases: true }` 就讀 wire keys（`display_name`），同 HTTP/JSON codecs 一樣。

## ErrorMap

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## 類型

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

`StructIssue`：`path`、`code`、`expected`、`received`、`message`。`code` 係 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或者 `missing_key`。

睇 [Struct guide](/zh-Hant-HK/docs/struct)。

## STRUCT

一個 `unique symbol`，用嚟標記由 endpoint input parse 出嚟嘅 objects。佢屬於 outbound encoder 嘅內部成員，只以 type 形式 export。唔好讀取或者設定佢。

## Struct

可以 parse 嘅 shape：input/output types，再加 `.optional()`、`.null()` / `.nullable()`、`.nullish()`、`.alias()`。

## StructLike

帶住 `_struct` type payload 嘅嘢。見 [`StructLike`](/zh-Hant-HK/api/core/structlike-type)。

## StructMethods

`.alias()`、`.null()` / `.nullable()`、`.nullish()`、`.optional()`。

## ObjectStruct

`struct.object` 整出嚟嘅 object-shaped struct。

## StructIssue

`path`、`code`、`expected`、`received`、`message`。`code` 係 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或者 `missing_key`。

## FormattedStructError

`StructError.format()` 吐出嚟嘅 nested `{ _errors, [key]: … }` tree。

## FlattenedStructError

`StructError.flatten()` 吐出嚟嘅 `formErrors` 加 `fieldErrors`。
