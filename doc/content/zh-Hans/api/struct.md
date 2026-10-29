---
title: Struct
description: struct 门面、Infer，以及 StructError。
---

# Struct

建传输边界的形状，parse 值，推断 TypeScript 类型。

## struct

门面。用这个，别直接碰内部构造函数。

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias("display_name"),
});

const [error, user] = struct.parse(User, { id: 1, displayName: "Ada" });
```

### 原语和容器

| 辅助函数                                                                    | 作用                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | 标量                                                                      |
| `struct.literal(value)`                                                     | 精确字面量                                                                |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown。`any()` 和 `unknown()` 会拒绝 `null` 和 `undefined` |
| `struct.date()`                                                             | `Date`                                                                    |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | 集合。`tuple` 接收一个数组：`struct.tuple([a, b])`                        |
| `struct.object(shape)`                                                      | 对象；字段可以 `.optional()`、`.null()` / `.nullable()`、`.alias(name)`   |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | 联合                                                                      |
| `struct.enum(values)`                                                       | 字符串列表或 `{ Name: value }` map；map 接受它的值，不接受它的 key        |

### 请求体编解码器和二进制值

| 辅助函数                                       | 作用                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | 对象 struct 再加一个 codec tag。这个 tag 只在该值是请求 body 根时生效                                                                                            |
| `struct.arrayBuffer()` / `blob()` / `file()`   | 二进制值。作为 body 根时按字节发送；作为 `output` / `error` 时选出那种表示                                                                                       |
| `struct.string()`                              | 文本。作为 HTTP 或 SSE 的 body 根，或作为 HTTP/SSE 入站数据时，字节保持原始文本。WebSocket 入站 frame 会先做 JSON parse，所以 string struct 期望的是 JSON 字符串 |

### struct.parse()

<ApiSignature name="struct.parse" />

- **返回** `[null, value]` 或 `[StructError, undefined]`。错误只带一个 issue。对象字段停在第一个坏字段。`struct.or` 会试完每个分支，然后报告 `invalid_union`，不保留第一个分支的失败。
- 对象字段默认必填，除非标了 `.optional()` 或 `.nullish()`。shape 没有声明的 key 会从结果中丢弃。
- 可选 `options.errorMap` 只改这一次 parse 的 issue 文案。
- 默认读**逻辑** key（`displayName`）。传 `{ aliases: true }` 则读传输 key（`display_name`），和 HTTP/JSON codec 一样。

## ErrorMap

<ApiSignature name="ErrorMap" />

## 类型

### Infer

### StructInput

### AnyStruct

### ParseResult

<ApiSignature name="Infer, StructInput, AnyStruct, ParseResult" />

### StructError

<ApiSignature name="StructError" />

`StructIssue`：`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

见 [Struct 指南](/zh-Hans/docs/struct)。

## STRUCT

一个 `unique symbol`，用来标记由 endpoint input 解析出来的对象。它属于出站编码器的内部实现，只作为类型导出。不要读取或设置它。

## Struct

能 parse 的形状：input/output 类型，加上 `.optional()`、`.null()` / `.nullable()`、`.nullish()`、`.alias()`。

## StructLike

带 `_struct` 类型载荷的东西。见 [`StructLike`](/zh-Hans/api/core/structlike-type)。

## StructMethods

`.alias()`、`.null()` / `.nullable()`、`.nullish()`、`.optional()`。

## ObjectStruct

`struct.object` 造出来的对象形状。

## StructIssue

`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

## FormattedStructError

`StructError.format()` 返回的嵌套 `{ _errors, [key]: … }` 树。

## FlattenedStructError

`StructError.flatten()` 返回的 `formErrors` 加 `fieldErrors`。
