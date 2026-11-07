---
title: Struct
description: struct facade、Infer，同 StructError。
---

# Struct

建立網絡邊界嘅資料形狀、解析值，再推斷 TypeScript 型別。

## struct

統一入口。優先用呢個，唔好用內部建構函式。

<include cwd lang="typescript">
  examples/api/struct.ts#example
</include>

### 基本型別同容器

| Helper                                                                      | 做咩                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | 純量                                                                      |
| `struct.literal(value)`                                                     | 精確字面值                                                                |
| `struct.null()` / `any()` / `unknown()`                                     | null / any / unknown。`any()` 同 `unknown()` 會拒絕 `null` 同 `undefined` |
| `struct.date()`                                                             | `Date`                                                                    |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | 集合。`tuple` 收一個 array：`struct.tuple([a, b])`                        |
| `struct.object(shape)`                                                      | object；欄位接受 `.optional()`、`.null()` / `.nullable()`、`.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | 聯合型別                                                                  |
| `struct.enum(values)`                                                       | 字串清單或者 `{ Name: value }` map；map 接受佢嘅值，唔係 key              |

### body codec 同二進位值

| Helper                                         | 做咩                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | object struct 再加一個 codec tag。個 tag 只會喺嗰個值係 request body 根值嗰陣先生效                                                                            |
| `struct.arrayBuffer()` / `blob()` / `file()`   | 二進位值。作為 body 根值會當 bytes 送出；作為 `output` / `error` 就會揀嗰種表示形式                                                                            |
| `struct.string()`                              | 文字。作為 HTTP 或 SSE body 根值，或者作為 HTTP/SSE 傳入資料，bytes 會保持係文字。WebSocket 傳入 frame 會先 JSON 解析，所以 string struct 預期一個 JSON string |

### struct.parse()

<ApiSignature name="struct.parse" />

- **Returns** `[null, value]` 或者 `[StructError, undefined]`。錯誤只帶一個 issue。object 欄位喺第一個出錯嘅欄位就停。`struct.or` 會試晒每個分支，然後報 `invalid_union`，唔會保留第一個分支嘅失敗。
- object 欄位必填，除非標記咗 `.optional()` 或者 `.nullish()`。形狀冇宣告嘅 key 會喺結果中被丟棄。
- 可選嘅 `options.errorMap` 只會改寫呢次解析嘅 issue message。
- 預設讀 **邏輯** key（`customerName`）。傳 `{ aliases: true }` 就讀網絡 key（`customer_name`），同 HTTP/JSON codec 一樣。

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

`StructIssue`：`path`、`code`、`expected`、`received`、`message`。`code` 係 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或者 `missing_key`。

睇[Struct 指南](/zh-Hant-HK/docs/struct)。

## STRUCT

一個 `unique symbol`，用嚟標記由操作 input 解析出嚟嘅 object。佢屬於傳出編碼器嘅內部成員，只以型別形式匯出。唔好讀取或者設定佢。

## Struct

可以解析嘅形狀：input/output 型別，再加 `.optional()`、`.null()` / `.nullable()`、`.nullish()`、`.alias()`。

## StructLike

帶住 `_struct` 型別 payload 嘅任何值。見 [`StructLike`](/zh-Hant-HK/api/core/structlike-type)。

## StructMethods

`.alias()`、`.null()` / `.nullable()`、`.nullish()`、`.optional()`。

## ObjectStruct

由 `struct.object` 建立嘅 object 形狀 struct。

## StructIssue

`path`、`code`、`expected`、`received`、`message`。`code` 係 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或者 `missing_key`。

## FormattedStructError

`StructError.format()` 產生嘅巢狀 `{ _errors, [key]: … }` 樹。

## FlattenedStructError

`StructError.flatten()` 產生嘅 `formErrors` 同 `fieldErrors`。
