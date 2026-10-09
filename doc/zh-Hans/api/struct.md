---
title: Struct
description: struct 门面、Infer，以及 StructError。
---

# Struct {#page}

建线上边界的形状，parse 值，推断 TypeScript 类型。

## struct {#struct}

门面。用这个，别直接碰内部构造函数。

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### 原语和容器

| Helper                                                                      | 作用                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | 标量                                                                    |
| `struct.literal(value)`                                                     | 精确字面量                                                              |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                    |
| `struct.date()`                                                             | `Date`                                                                  |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | 集合                                                                    |
| `struct.object(shape)`                                                      | 对象；字段可以 `.optional()`、`.null()` / `.nullable()`、`.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | 联合                                                                    |
| `struct.enum(values)`                                                       | 字符串列表或 `{ Name: value }` map                                      |

### Body codec 和二进制值

| Helper                                         | 作用                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | 对象 struct 再加一个 codec tag。这个 tag 只在该值是请求 body 根时生效      |
| `struct.arrayBuffer()` / `blob()` / `file()`   | 二进制值。作为 body 根时按字节发送；作为 `output` / `error` 时选出那种表示 |
| `struct.string()`                              | 文本。作为 body 根，或作为入站 `string` struct 时，字节保持文本            |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **返回** `[null, value]` 或 `[StructError, undefined]`。
- 可选 `errorMap` 只改这一次 parse 的 issue 文案。
- 默认读**逻辑** key（`displayName`）。传 `{ aliases: true }` 则读线上 key（`display_name`），和 HTTP/JSON codec 一样。

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## 类型

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

见 [Struct 指南](/core/struct)。

## Struct {#Struct}

能 parse 的形状：input/output 类型，加上 `.optional()`、`.null()` / `.nullable()`、`.nullish()`、`.alias()`。

## StructLike {#StructLike}

带 `_struct` 类型载荷的东西。

## StructMethods {#StructMethods}

`.alias()`、`.null()` / `.nullable()`、`.nullish()`、`.optional()`。

## ObjectStruct {#ObjectStruct}

`struct.object` 造出来的对象形状。

## StructIssue {#StructIssue}

`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

## FormattedStructError {#FormattedStructError}

`StructError.format()` 吐的嵌套 `{ _errors, [key]: … }` 树。

## FlattenedStructError {#FlattenedStructError}

`StructError.flatten()` 吐的 `formErrors` 加 `fieldErrors`。
