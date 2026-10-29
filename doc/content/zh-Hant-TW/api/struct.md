---
title: Struct
description: struct facade、Infer，以及 StructError。
---

# Struct

組 wire 邊界的形狀、剖析值、推導 TypeScript 型別。

## struct

Facade。請走這個，別用內部 constructors。

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias("display_name"),
});

const [error, user] = struct.parse(User, { id: 1, displayName: "Ada" });
```

### 純量與容器

| Helper                                                                      | 用途                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | 純量                                                                    |
| `struct.literal(value)`                                                     | 精確字面值                                                              |
| `struct.null()` / `any()` / `unknown()`                                     | Null／any／unknown。`any()` 與 `unknown()` 會拒絕 `null` 與 `undefined` |
| `struct.date()`                                                             | `Date`                                                                  |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | 集合。`tuple` 接一個陣列：`struct.tuple([a, b])`                        |
| `struct.object(shape)`                                                      | 物件；欄位可接 `.optional()`、`.null()` / `.nullable()`、`.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | 聯集                                                                    |
| `struct.enum(values)`                                                       | 字串清單或 `{ Name: value }` map；map 接受的是它的值，不是它的 key      |

### Body codecs 與二進位值

| Helper                                         | 用途                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | 物件 struct 加上 codec tag。只有該值是 request body 根時，tag 才生效                                                                                        |
| `struct.arrayBuffer()` / `blob()` / `file()`   | 二進位值。當 body 根時以 bytes 送出；當 `output`／`error` 時選那個 representation                                                                           |
| `struct.string()`                              | 文字。當 HTTP 或 SSE 的 body 根，或當 HTTP／SSE 入站資料時，bytes 維持文字。WebSocket 進來的 frame 會先做 JSON parse，所以 string struct 預期的是 JSON 字串 |

### struct.parse()

<ApiSignature name="struct.parse" />

- **回傳** `[null, value]` 或 `[StructError, undefined]`。error 只帶一個 issue。物件欄位在第一個壞欄位就停止。`struct.or` 會試每一個分支，然後回報 `invalid_union`，不會保留第一個分支的失敗。
- 物件欄位必填，除非標了 `.optional()` 或 `.nullish()`。形狀沒有宣告的 key 會從結果中丟掉。
- 選填的 `options.errorMap` 只改這一次 parse 的 issue 文案。
- 預設讀**邏輯** keys（`displayName`）。傳 `{ aliases: true }` 會讀 wire keys（`display_name`），跟 HTTP／JSON codecs 一樣。

## ErrorMap

<ApiSignature name="ErrorMap" />

## 型別

### Infer

### StructInput

### AnyStruct

### ParseResult

<ApiSignature name="Infer, StructInput, AnyStruct, ParseResult" />

### StructError

<ApiSignature name="StructError" />

`StructIssue`：`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

見 [Struct 指南](/zh-Hant-TW/docs/struct)。

## STRUCT

一個 `unique symbol`，用來標記從 endpoint input 剖析出來的物件。它是出站 encoder 的內部細節，只以型別形式匯出。不要讀取或設定它。

## Struct

能 parse 的形狀：input／output 型別，加上 `.optional()`、`.null()`／`.nullable()`、`.nullish()`、`.alias()`。

## StructLike

帶 `_struct` 型別載荷的東西。見 [`StructLike`](/zh-Hant-TW/api/core/structlike-type)。

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

`struct.object` 做出來的物件形狀。

## StructIssue

`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

## FormattedStructError

`StructError.format()` 吐出的巢狀 `{ _errors, [key]: … }`。

## FlattenedStructError

`StructError.flatten()` 吐出的 `formErrors` 加 `fieldErrors`。
