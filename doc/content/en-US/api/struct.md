---
title: Struct
description: struct facade, Infer, and StructError.
---

# Struct

Build wire-boundary shapes, parse values, and infer TypeScript types.

## struct

Facade. Prefer this over internal constructors.

<include cwd lang="typescript">
  examples/api/struct.ts#example
</include>

### Primitives and containers

| Helper                                                                      | Role                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Scalars                                                                        |
| `struct.literal(value)`                                                     | Exact literal                                                                  |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()` and `unknown()` reject `null` and `undefined`    |
| `struct.date()`                                                             | `Date`                                                                         |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | Collections. `tuple` takes one array: `struct.tuple([a, b])`                   |
| `struct.object(shape)`                                                      | Object; fields accept `.optional()`, `.null()` / `.nullable()`, `.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                         |
| `struct.enum(values)`                                                       | String list or `{ Name: value }` map; the map accepts its values, not its keys |

### Body codecs and binary values

| Helper                                         | Role                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `struct.formData(shape)` / `urlencoded(shape)` | Object struct plus a codec tag. The tag applies only when that value is the request body root                                                                                  |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Binary values. As a body root they are sent as bytes; as `output` / `error` they select that representation                                                                    |
| `struct.string()`                              | Text. As an HTTP or SSE body root, or as HTTP/SSE inbound data, the bytes stay text. A WebSocket incoming frame is JSON-parsed first, so a string struct expects a JSON string |

### struct.parse()

<ApiSignature name="struct.parse" />

- **Returns** `[null, value]` or `[StructError, undefined]`. The error carries one issue. Object fields stop at the first bad field. `struct.or` tries every branch and then reports `invalid_union`; it does not keep the first branch failure.
- Object fields are required unless marked `.optional()` or `.nullish()`. Keys the shape does not declare are dropped from the result.
- Optional `options.errorMap` rewrites issue messages for this parse only.
- By default, parsing reads **logical** keys (`customerName`). Pass `{ aliases: true }` to read wire keys (`customer_name`) the same way HTTP/JSON codecs do.

## ErrorMap

<ApiSignature name="ErrorMap" />

## Types

### Infer

### StructInput

### AnyStruct

### ParseResult

<ApiSignature name="Infer, StructInput, AnyStruct, ParseResult" />

### StructError

<ApiSignature name="StructError" />

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` is `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, or `missing_key`.

See [Struct guide](/docs/struct).

## STRUCT

A `unique symbol` that tags the objects parsed from operation input. It is internal to the outbound encoder and is exported as a type only. Do not read or set it.

## Struct

A parseable shape: input/output types plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Anything with a `_struct` type payload. See [`StructLike`](/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

Object-shaped struct from `struct.object`.

## ArrayStruct

Array struct from `struct.array`.

## RecordStruct

Record struct from `struct.record`.

## TupleStruct

Tuple struct from `struct.tuple`.

## UnionStruct

Union struct from `struct.or`.

## DiscriminatedUnionStruct

Discriminated-union struct from `struct.discriminatedUnion`.

## IntersectionStruct

Intersection struct from `struct.intersection`.

## PreservedStruct

The struct that a modifier such as `.optional()` or `.nullable()` returns for a composite struct; it keeps the composite's type.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` is `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, or `missing_key`.

## FormattedStructError

Nested `{ _errors, [key]: … }` tree from `StructError.format()`.

## FlattenedStructError

`formErrors` plus `fieldErrors` from `StructError.flatten()`.
