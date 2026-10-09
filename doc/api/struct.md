---
title: Struct
description: struct facade, Infer, and StructError.
---

# Struct {#page}

Build wire-boundary shapes, parse values, infer TypeScript types.

## struct {#struct}

Facade. Prefer this over internal constructors.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### Primitives and containers

| Helper                                                                      | Role                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Scalars                                                                        |
| `struct.literal(value)`                                                     | Exact literal                                                                  |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                           |
| `struct.date()`                                                             | `Date`                                                                         |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | Collections                                                                    |
| `struct.object(shape)`                                                      | Object; fields accept `.optional()`, `.null()` / `.nullable()`, `.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                         |
| `struct.enum(values)`                                                       | String list or `{ Name: value }` map                                           |

### Body codecs and binary values

| Helper                                         | Role                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Object struct plus a codec tag. The tag applies only when that value is the request body root               |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Binary values. As a body root they are sent as bytes; as `output` / `error` they select that representation |
| `struct.string()`                              | Text. As a body root or an inbound `string` struct, the bytes stay text                                     |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Returns** `[null, value]` or `[StructError, undefined]`.
- Optional `errorMap` rewrites issue messages for this parse only.
- Default reads **logical** keys (`displayName`). Pass `{ aliases: true }` to read wire keys (`display_name`) the same way HTTP/JSON codecs do.

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## Types

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

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` is `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, or `missing_key`.

See [Struct guide](/core/struct).

## Struct {#Struct}

A parseable shape: input/output types plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike {#StructLike}

Anything with a `_struct` type payload.

## StructMethods {#StructMethods}

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct {#ObjectStruct}

Object-shaped struct from `struct.object`.

## StructIssue {#StructIssue}

`path`, `code`, `expected`, `received`, `message`. `code` is `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, or `missing_key`.

## FormattedStructError {#FormattedStructError}

Nested `{ _errors, [key]: … }` tree from `StructError.format()`.

## FlattenedStructError {#FlattenedStructError}

`formErrors` plus `fieldErrors` from `StructError.flatten()`.
