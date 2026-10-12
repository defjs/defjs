---
title: Struct
description: struct-Facade, Infer und StructError.
---

# Struct

Baue Wire-Boundary-Shapes, parse Werte, inferiere TypeScript-Types.

## struct

Facade. Lieber das als interne Constructors.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### Primitive und Container

| Helfer                                                                      | Rolle                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Scalars                                                                                  |
| `struct.literal(value)`                                                     | Exaktes Literal                                                                          |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()` und `unknown()` lehnen `null` und `undefined` ab           |
| `struct.date()`                                                             | `Date`                                                                                   |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | Collections. `tuple` nimmt ein Array: `struct.tuple([a, b])`                             |
| `struct.object(shape)`                                                      | Object; Fields akzeptieren `.optional()`, `.null()` / `.nullable()`, `.alias(name)`      |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                                   |
| `struct.enum(values)`                                                       | String-Liste oder `{ Name: value }`-Map; die Map akzeptiert ihre Values, nicht ihre Keys |

### Body-Codecs und Binary-Werte

| Helfer                                         | Rolle                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Object-Struct plus Codec-Tag. Der Tag gilt nur, wenn dieser Wert der Request-Body-Root ist                        |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Binary-Werte. Als Body-Root werden sie als Bytes gesendet; als `output` / `error` wählen sie diese Representation |
| `struct.string()`                              | Text. Als Body-Root oder inbound `string`-Struct bleiben die Bytes Text                                           |

### struct.parse()

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Returns** `[null, value]` oder `[StructError, undefined]`. Das Parsen endet beim ersten Fehler, der Error trägt also genau ein Issue.
- Object-Fields sind erforderlich, sofern sie nicht mit `.optional()` oder `.nullish()` markiert sind. Keys, die die Shape nicht deklariert, fallen aus dem Ergebnis.
- Optionales `errorMap` schreibt Issue-Messages nur für dieses Parse um.
- Default liest **logische** Keys (`displayName`). Gib `{ aliases: true }`, um Wire-Keys (`display_name`) zu lesen, so wie HTTP-/JSON-Codecs es tun.

## ErrorMap

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## Typen

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

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` ist `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` oder `missing_key`.

Siehe [Struct-Guide](/de-DE/docs/struct).

## STRUCT

Ein `unique symbol`, das die aus Endpoint-Input geparsten Objekte markiert. Er ist intern für den Outbound-Encoder und wird nur als Typ exportiert. Weder lesen noch setzen.

## Struct

Parsebare Form: Input-/Output-Typen plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Alles mit einem `_struct`-Typ-Payload. Siehe [`StructLike`](/de-DE/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

Objektförmiges Struct von `struct.object`.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` ist `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` oder `missing_key`.

## FormattedStructError

Verschachtelter `{ _errors, [key]: … }`-Baum von `StructError.format()`.

## FlattenedStructError

`formErrors` plus `fieldErrors` von `StructError.flatten()`.
