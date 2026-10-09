---
title: Struct
description: Fachada struct, Infer y StructError.
---

# Struct {#page}

Construye formas del límite de cable, parsea valores e infiere tipos TypeScript.

## struct {#struct}

Fachada. Prefiere esto frente a los constructores internos.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### Primitivos y contenedores

| Helper                                                                      | Rol                                                                                 |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Escalares                                                                           |
| `struct.literal(value)`                                                     | Literal exacto                                                                      |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                                |
| `struct.date()`                                                             | `Date`                                                                              |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | Colecciones                                                                         |
| `struct.object(shape)`                                                      | Objeto; los campos aceptan `.optional()`, `.null()` / `.nullable()`, `.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Uniones                                                                             |
| `struct.enum(values)`                                                       | Lista de strings o mapa `{ Name: value }`                                           |

### Códecs de body y valores binarios

| Helper                                         | Rol                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Struct de objeto más un tag de códec. El tag solo aplica cuando ese valor es la raíz del body de la solicitud    |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Valores binarios. Como raíz de body se envían como bytes; como `output` / `error` seleccionan esa representación |
| `struct.string()`                              | Texto. Como raíz de body o como struct `string` de entrada, los bytes siguen siendo texto                        |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Devuelve** `[null, value]` o `[StructError, undefined]`.
- `errorMap` opcional reescribe los mensajes de issue solo para este parse.
- Por defecto lee claves **lógicas** (`displayName`). Pasa `{ aliases: true }` para leer claves de cable (`display_name`) igual que los códecs HTTP/JSON.

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## Tipos

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

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` es `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` o `missing_key`.

Mira la [guía de Struct](/core/struct).

## Struct {#Struct}

Forma parseable: tipos input/output más `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike {#StructLike}

Cualquier cosa con un payload de tipo `_struct`.

## StructMethods {#StructMethods}

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct {#ObjectStruct}

Struct con forma de objeto, de `struct.object`.

## StructIssue {#StructIssue}

`path`, `code`, `expected`, `received`, `message`. `code` es `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` o `missing_key`.

## FormattedStructError {#FormattedStructError}

Árbol anidado `{ _errors, [key]: … }` de `StructError.format()`.

## FlattenedStructError {#FlattenedStructError}

`formErrors` más `fieldErrors` de `StructError.flatten()`.
