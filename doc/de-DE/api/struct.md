---
title: Struct
description: struct-Facade, Infer und StructError.
---

# Struct {#page}

Baue Wire-Boundary-Shapes, parse Values, inferiere TypeScript-Types.

## struct {#struct}

Facade. Lieber das als interne Constructors.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### Primitive und Container

| Helfer                                                                      | Rolle                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Scalars                                                                             |
| `struct.literal(value)`                                                     | Exaktes Literal                                                                     |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                                |
| `struct.date()`                                                             | `Date`                                                                              |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | Collections                                                                         |
| `struct.object(shape)`                                                      | Object; Fields akzeptieren `.optional()`, `.null()` / `.nullable()`, `.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                              |
| `struct.enum(values)`                                                       | String-Liste oder `{ Name: value }`-Map                                             |

### Body-Codecs und Binary-Werte

| Helfer                                         | Rolle                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Object-Struct plus Codec-Tag. Der Tag gilt nur, wenn dieser Wert der Request-Body-Root ist                        |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Binary-Werte. Als Body-Root werden sie als Bytes gesendet; als `output` / `error` wählen sie diese Representation |
| `struct.string()`                              | Text. Als Body-Root oder inbound `string`-Struct bleiben die Bytes Text                                           |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Returns** `[null, value]` oder `[StructError, undefined]`.
- Optionales `errorMap` schreibt Issue-Messages nur für dieses Parse um.
- Default liest **logische** Keys (`displayName`). Gib `{ aliases: true }`, um Wire-Keys (`display_name`) zu lesen, so wie HTTP-/JSON-Codecs es tun.

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## Typen

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

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` ist `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` oder `missing_key`.

Siehe [Struct-Guide](/core/struct).

## Struct {#Struct}

Parsebare Form: Input-/Output-Typen plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike {#StructLike}

Alles mit einem `_struct`-Typ-Payload.

## StructMethods {#StructMethods}

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct {#ObjectStruct}

Objektförmiges Struct von `struct.object`.

## StructIssue {#StructIssue}

`path`, `code`, `expected`, `received`, `message`. `code` ist `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` oder `missing_key`.

## FormattedStructError {#FormattedStructError}

Verschachtelter `{ _errors, [key]: … }`-Baum von `StructError.format()`.

## FlattenedStructError {#FlattenedStructError}

`formErrors` plus `fieldErrors` von `StructError.flatten()`.
