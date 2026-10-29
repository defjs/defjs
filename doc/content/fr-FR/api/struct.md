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
  displayName: struct.string().alias("display_name"),
});

function readUser() {
  const [error, user] = struct.parse(User, { id: 1, displayName: "Ada" });
  if (error) {
    console.error(error.message);
    return;
  }
  console.log(user.displayName);
}

readUser();
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

| Helper                                         | Rôle                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Struct objet plus un tag de codec. Le tag ne s’applique que quand cette valeur est la racine du corps de requête                                                                                            |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Valeurs binaires. En racine de corps elles partent en octets ; en `output` / `error` elles sélectionnent cette représentation                                                                               |
| `struct.string()`                              | Texte. En racine de corps HTTP ou SSE, ou en données entrantes HTTP/SSE, les octets restent du texte. Une frame WebSocket entrante est d’abord parsée en JSON, donc un struct string attend une string JSON |

### struct.parse()

<ApiSignature name="struct.parse" />

- **Renvoie** `[null, value]` ou `[StructError, undefined]`. L’erreur porte une seule issue. Les champs d’un objet s’arrêtent au premier champ invalide. `struct.or` essaie chaque branche, puis signale `invalid_union` ; il ne garde pas l’échec de la première branche.
- Les champs d’un objet sont obligatoires sauf s’ils sont marqués `.optional()` ou `.nullish()`. Les clés que la forme ne déclare pas sont retirées du résultat.
- Un `options.errorMap` optionnel réécrit les messages d’issue pour ce parse seulement.
- Par défaut, lecture des clés **logiques** (`displayName`). Passe `{ aliases: true }` pour lire les clés wire (`display_name`) comme le font les codecs HTTP/JSON.

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
