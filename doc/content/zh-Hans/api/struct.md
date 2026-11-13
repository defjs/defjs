---
title: Struct
description: struct 门面、Infer，以及 StructError。
---

# Struct

构建网络边界上的形状、解析值，并推断 TypeScript 类型。

## struct

门面。优先使用它，而不是内部构造函数。

<include cwd lang="typescript">
  examples/api/struct.ts#example
</include>

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

- **返回** `[null, value]` 或 `[StructError, undefined]`。错误携带一个 issue。对象字段在第一个错误字段处停止。`struct.or` 会尝试每个分支，然后报告 `invalid_union`，不保留第一个分支的失败。
- 对象字段默认必填，除非标记了 `.optional()` 或 `.nullish()`。shape 未声明的键会从结果中丢弃。
- 可选 `options.errorMap` 只改写本次解析的 issue 消息。
- 默认读取**逻辑**键（`customerName`）。传入 `{ aliases: true }` 会像 HTTP/JSON 编解码器一样读取网络键（`customer_name`）。

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

一个 `unique symbol`，用于标记由操作 input 解析出的对象。它属于出站编码器的内部实现，只作为类型导出。不要读取或设置它。

## Struct

可解析的形状：input/output 类型，加上 `.optional()`、`.null()` / `.nullable()`、`.nullish()`、`.alias()`。

## StructLike

带 `_struct` 类型载荷的东西。见 [`StructLike`](/zh-Hans/api/core/structlike-type)。

## StructMethods

`.alias()`、`.null()` / `.nullable()`、`.nullish()`、`.optional()`。

## StringStruct

由 `struct.string` 构造的字符串 struct。

## NumberStruct

由 `struct.number` 构造的数字 struct。

## UnknownStruct

由 `struct.unknown` 构造的 unknown struct。

## ObjectStruct

由 `struct.object` 构造的对象 struct。

## ArrayStruct

由 `struct.array` 构造的数组 struct。

## RecordStruct

由 `struct.record` 构造的 record struct。

## TupleStruct

由 `struct.tuple` 构造的元组 struct。

## UnionStruct

由 `struct.or` 构造的联合 struct。

## DiscriminatedUnionStruct

由 `struct.discriminatedUnion` 构造的可辨识联合 struct。

## IntersectionStruct

由 `struct.intersection` 构造的交叉 struct。

## PreservedStruct

对复合 struct 调用 `.optional()`、`.nullable()` 等修饰符时返回的 struct，保留该复合 struct 的类型。

## StructIssue

`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

## FormattedStructError

`StructError.format()` 返回的嵌套 `{ _errors, [key]: … }` 树。

## FlattenedStructError

`StructError.flatten()` 返回的 `formErrors` 加 `fieldErrors`。
