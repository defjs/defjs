---
title: Struct
description: struct facade, Infer, and StructError.
---

# Struct

Build wire-boundary shapes, parse values, infer TypeScript types.

## struct

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
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()` and `unknown()` reject `null` and `undefined`    |
| `struct.date()`                                                             | `Date`                                                                         |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | Collections. `tuple` takes one array: `struct.tuple([a, b])`                   |
| `struct.object(shape)`                                                      | Object; fields accept `.optional()`, `.null()` / `.nullable()`, `.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                         |
| `struct.enum(values)`                                                       | String list or `{ Name: value }` map; the map accepts its values, not its keys |

### Body codecs and binary values

| Helper                                         | Role                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Object struct plus a codec tag. The tag applies only when that value is the request body root               |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Binary values. As a body root they are sent as bytes; as `output` / `error` they select that representation |
| `struct.string()`                              | Text. As a body root or an inbound `string` struct, the bytes stay text                                     |

### struct.parse()

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Returns** `[null, value]` or `[StructError, undefined]`. Parsing stops at the first failure, so the error carries one issue.
- Object fields are required unless marked `.optional()` or `.nullish()`. Keys the shape does not declare are dropped from the result.
- Optional `errorMap` rewrites issue messages for this parse only.
- Default reads **logical** keys (`displayName`). Pass `{ aliases: true }` to read wire keys (`display_name`) the same way HTTP/JSON codecs do.

## ErrorMap

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## Types

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

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` is `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, or `missing_key`.

See [Struct guide](/docs/struct).

## STRUCT

A `unique symbol` that tags the objects parsed from endpoint input. It is internal to the outbound encoder and is exported as a type only. Do not read or set it.

## Struct

A parseable shape: input/output types plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Anything with a `_struct` type payload. See [`StructLike`](/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

Object-shaped struct from `struct.object`.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` is `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, or `missing_key`.

## FormattedStructError

Nested `{ _errors, [key]: … }` tree from `StructError.format()`.

## FlattenedStructError

`formErrors` plus `fieldErrors` from `StructError.flatten()`.
