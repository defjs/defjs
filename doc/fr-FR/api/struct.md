---
title: Struct
description: Façade struct, Infer, et StructError.
---

# Struct {#page}

Construis des formes à la frontière wire, parse des valeurs, infère les types TypeScript.

## struct {#struct}

Façade. Préfère-la aux constructeurs internes.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### Primitives et conteneurs

| Helper                                                                      | Rôle                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Scalaires                                                                             |
| `struct.literal(value)`                                                     | Littéral exact                                                                        |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                                  |
| `struct.date()`                                                             | `Date`                                                                                |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | Collections                                                                           |
| `struct.object(shape)`                                                      | Objet ; les champs acceptent `.optional()`, `.null()` / `.nullable()`, `.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                                |
| `struct.enum(values)`                                                       | Liste de strings ou map `{ Name: value }`                                             |

### Codecs de corps et valeurs binaires

| Helper                                         | Rôle                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Struct objet plus un tag de codec. Le tag ne s’applique que quand cette valeur est la racine du corps de requête              |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Valeurs binaires. En racine de corps elles partent en octets ; en `output` / `error` elles sélectionnent cette représentation |
| `struct.string()`                              | Texte. En racine de corps ou en struct `string` entrant, les octets restent du texte                                          |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Renvoie** `[null, value]` ou `[StructError, undefined]`.
- Un `errorMap` optionnel réécrit les messages d’issue pour ce parse seulement.
- Par défaut, lecture des clés **logiques** (`displayName`). Passe `{ aliases: true }` pour lire les clés wire (`display_name`) comme le font les codecs HTTP/JSON.

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

`StructIssue` : `path`, `code`, `expected`, `received`, `message`. `code` vaut `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` ou `missing_key`.

Voir le [guide Struct](/core/struct).

## Struct {#Struct}

Une forme parseable : types d’entrée/sortie plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike {#StructLike}

Tout ce qui a un payload de type `_struct`.

## StructMethods {#StructMethods}

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct {#ObjectStruct}

Struct en forme d’objet, issu de `struct.object`.

## StructIssue {#StructIssue}

`path`, `code`, `expected`, `received`, `message`. `code` vaut `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` ou `missing_key`.

## FormattedStructError {#FormattedStructError}

Arbre `{ _errors, [key]: … }` imbriqué, issu de `StructError.format()`.

## FlattenedStructError {#FlattenedStructError}

`formErrors` plus `fieldErrors`, issus de `StructError.flatten()`.
