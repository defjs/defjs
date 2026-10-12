---
title: Struct
description: Façade struct, Infer, et StructError.
---

# Struct

Construis des formes à la frontière wire, parse des valeurs, infère les types TypeScript.

## struct

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
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()` et `unknown()` rejettent `null` et `undefined`          |
| `struct.date()`                                                             | `Date`                                                                                |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | Collections. `tuple` prend un seul tableau : `struct.tuple([a, b])`                   |
| `struct.object(shape)`                                                      | Objet ; les champs acceptent `.optional()`, `.null()` / `.nullable()`, `.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                                |
| `struct.enum(values)`                                                       | Liste de strings ou map `{ Name: value }` ; la map accepte ses valeurs, pas ses clés  |

### Codecs de corps et valeurs binaires

| Helper                                         | Rôle                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Struct objet plus un tag de codec. Le tag ne s’applique que quand cette valeur est la racine du corps de requête              |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Valeurs binaires. En racine de corps elles partent en octets ; en `output` / `error` elles sélectionnent cette représentation |
| `struct.string()`                              | Texte. En racine de corps ou en struct `string` entrant, les octets restent du texte                                          |

### struct.parse()

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Renvoie** `[null, value]` ou `[StructError, undefined]`. Le parsing s’arrête au premier échec : l’erreur porte donc une seule issue.
- Les champs d’un objet sont obligatoires sauf s’ils sont marqués `.optional()` ou `.nullish()`. Les clés que la forme ne déclare pas sont retirées du résultat.
- Un `errorMap` optionnel réécrit les messages d’issue pour ce parse seulement.
- Par défaut, lecture des clés **logiques** (`displayName`). Passe `{ aliases: true }` pour lire les clés wire (`display_name`) comme le font les codecs HTTP/JSON.

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

`StructIssue` : `path`, `code`, `expected`, `received`, `message`. `code` vaut `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` ou `missing_key`.

Voir le [guide Struct](/fr-FR/docs/struct).

## STRUCT

Un `unique symbol` qui étiquette les objets parsés à partir de l’entrée d’un endpoint. Il est interne à l’encodeur sortant et n’est exporté que comme type. Ne le lis pas et ne le définis pas.

## Struct

Une forme parseable : types d’entrée/sortie plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Tout ce qui a un payload de type `_struct`. Voir [`StructLike`](/fr-FR/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

Struct en forme d’objet, issu de `struct.object`.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` vaut `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` ou `missing_key`.

## FormattedStructError

Arbre `{ _errors, [key]: … }` imbriqué, issu de `StructError.format()`.

## FlattenedStructError

`formErrors` plus `fieldErrors`, issus de `StructError.flatten()`.
