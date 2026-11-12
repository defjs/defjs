---
title: Struct
description: struct facade、Infer 與 StructError。
---

# Struct

建立傳輸邊界的形狀、剖析值，並推導 TypeScript 型別。

## struct

Facade。請優先使用這個，不要直接用內部的建構子。

<include cwd lang="typescript">
  examples/api/struct.ts#example
</include>

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
| `struct.enum(values)`                                                       | 字串清單或 `{ Name: value }` 對照表；對照表接受的是它的值，不是它的鍵   |

### 本文編解碼器與二進位值

| Helper                                         | 用途                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | 物件 struct 加上 codec 標記。只有該值作為請求本文的根時，標記才生效                                                                                        |
| `struct.arrayBuffer()` / `blob()` / `file()`   | 二進位值。作為本文根時以位元組送出；作為 `output`／`error` 時則選用該表示法                                                                                |
| `struct.string()`                              | 文字。作為 HTTP 或 SSE 的本文根，或作為 HTTP／SSE 的入站資料時，位元組仍維持文字。WebSocket 的入站訊框會先剖析 JSON，所以 string struct 預期的是 JSON 字串 |

### struct.parse()

<ApiSignature name="struct.parse" />

- **回傳** `[null, value]` 或 `[StructError, undefined]`。錯誤只帶一個 issue。物件欄位遇到第一個有問題的欄位就停止。`struct.or` 會試過每個分支，再回報 `invalid_union`；它不會保留第一個分支的失敗。
- 物件欄位預設必填，除非標記 `.optional()` 或 `.nullish()`。形狀未宣告的鍵會從結果中移除。
- 選用的 `options.errorMap` 只改寫這一次剖析的 issue 訊息。
- 預設剖析會讀取**邏輯**鍵（`customerName`）。傳入 `{ aliases: true }` 則改讀傳輸鍵（`customer_name`），與 HTTP／JSON 編解碼器的行為相同。

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

一個 `unique symbol`，用來標記從操作 input 剖析出來的物件。它是出站編碼器的內部細節，只以型別形式匯出。請勿讀取或設定它。

## Struct

可剖析的形狀：input／output 型別，加上 `.optional()`、`.null()`／`.nullable()`、`.nullish()` 與 `.alias()`。

## StructLike

帶有 `_struct` 型別酬載的東西。見 [`StructLike`](/zh-Hant-TW/api/core/structlike-type)。

## StructMethods

`.alias()`、`.null()`／`.nullable()`、`.nullish()`、`.optional()`。

## ObjectStruct

由 `struct.object` 建立的物件形狀。

## ArrayStruct

由 `struct.array` 建立的陣列 struct。

## RecordStruct

由 `struct.record` 建立的 record struct。

## TupleStruct

由 `struct.tuple` 建立的元組 struct。

## UnionStruct

由 `struct.or` 建立的聯集 struct。

## DiscriminatedUnionStruct

由 `struct.discriminatedUnion` 建立的可辨識聯集 struct。

## IntersectionStruct

由 `struct.intersection` 建立的交集 struct。

## PreservedStruct

對複合 struct 呼叫 `.optional()`、`.nullable()` 等修飾符時回傳的 struct，保留該複合 struct 的型別。

## StructIssue

`path`、`code`、`expected`、`received`、`message`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。

## FormattedStructError

`StructError.format()` 產生的巢狀 `{ _errors, [key]: … }` 樹狀結構。

## FlattenedStructError

`StructError.flatten()` 產生的 `formErrors` 加上 `fieldErrors`。
