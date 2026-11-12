---
title: Struct
description: Façade struct, Infer, et StructError.
---

# Struct

Construisez des formes à la frontière réseau, analysez des valeurs et inférez les types TypeScript.

## struct

Façade. Préférez-la aux constructeurs internes.

<include cwd lang="typescript">
  examples/api/struct.ts#example
</include>

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
| `struct.enum(values)`                                                       | Liste de chaînes ou map `{ Name: value }` ; la map accepte ses valeurs, pas ses clés  |

### Codecs de corps et valeurs binaires

| Helper                                         | Rôle                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Struct objet plus un tag de codec. Le tag ne s’applique que quand cette valeur est la racine du corps de requête                                                                                              |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Valeurs binaires. En racine de corps elles partent en octets ; en `output` / `error` elles sélectionnent cette représentation                                                                                 |
| `struct.string()`                              | Texte. En racine de corps HTTP ou SSE, ou en données entrantes HTTP/SSE, les octets restent du texte. Une trame WebSocket entrante est d'abord analysée en JSON, donc un struct string attend une chaîne JSON |

### struct.parse()

<ApiSignature name="struct.parse" />

- **Renvoie** `[null, value]` ou `[StructError, undefined]`. L’erreur porte une seule issue. Les champs d’un objet s’arrêtent au premier champ invalide. `struct.or` essaie chaque branche, puis signale `invalid_union` ; il ne garde pas l’échec de la première branche.
- Les champs d’un objet sont obligatoires sauf s’ils sont marqués `.optional()` ou `.nullish()`. Les clés que la forme ne déclare pas sont retirées du résultat.
- Un `options.errorMap` optionnel réécrit les messages d’issue pour cette analyse seulement.
- Par défaut, lecture des clés **logiques** (`customerName`). Passez `{ aliases: true }` pour lire les clés réseau (`customer_name`) comme le font les codecs HTTP/JSON.

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

`StructIssue` : `path`, `code`, `expected`, `received`, `message`. `code` vaut `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` ou `missing_key`.

Voir le [guide Struct](/fr-FR/docs/struct).

## STRUCT

Un `unique symbol` qui étiquette les objets analysés à partir de l'entrée d'une opération. Il est interne à l’encodeur sortant et n’est exporté que comme type. Ne le lisez pas et ne le définissez pas.

## Struct

Une forme analysable : types d’entrée/sortie plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Tout ce qui a une charge utile de type `_struct`. Voir [`StructLike`](/fr-FR/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

Struct en forme d’objet, issu de `struct.object`.

## ArrayStruct

Struct de tableau, issu de `struct.array`.

## RecordStruct

Struct d’enregistrement, issu de `struct.record`.

## TupleStruct

Struct de tuple, issu de `struct.tuple`.

## UnionStruct

Struct d’union, issu de `struct.or`.

## DiscriminatedUnionStruct

Struct d’union discriminée, issu de `struct.discriminatedUnion`.

## IntersectionStruct

Struct d’intersection, issu de `struct.intersection`.

## PreservedStruct

Le struct que renvoie un modificateur tel que `.optional()` ou `.nullable()` sur un struct composite ; il conserve le type du composite.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` vaut `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` ou `missing_key`.

## FormattedStructError

Arbre `{ _errors, [key]: … }` imbriqué, issu de `StructError.format()`.

## FlattenedStructError

`formErrors` plus `fieldErrors`, issus de `StructError.flatten()`.
