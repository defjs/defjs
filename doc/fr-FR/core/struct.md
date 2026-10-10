---
title: Struct
description: Modélise les formes de requête et de réponse, parse des inconnues, et encode les corps wire.
---

# Struct

Modélise une requête (et ses réponses) comme des Structs. Tu obtiens des types TypeScript via `Infer`, et des contrôles runtime via `struct.parse(...)` — pas de throw, tuple erreur en premier.

## Basic Setup

```typescript twoslash
import { defineRequest, struct, type Infer } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  active: struct.boolean(),
})

type User = Infer<typeof User>

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({
    name: struct.string(),
    email: struct.string(),
  }),
  builder: (input) => ({ body: input }),
  output: User,
})

const [parseError, user] = struct.parse(User, { id: 7, name: 'Ada', active: true })
if (!parseError) console.log(user.name)
void createUser
```

La sortie parsée ne garde que les champs déclarés. Champ requis manquant, mauvaise primitive, valeur imbriquée fausse, mauvaise longueur de tuple, ou `null` interdit → `StructError`, pas de valeur partielle. Les Structs sont immuables ; `.optional()` et compagnie renvoient un nouveau Struct.

## Requis, optionnel, null

Présence et nullabilité sont séparées :

| Déclaration                  | Manquant / `undefined`                 | `null`  | Valeur valide      |
| ---------------------------- | -------------------------------------- | ------- | ------------------ |
| `struct.string()`            | Rejette                                | Rejette | Accepte string     |
| `struct.string().optional()` | Accepte ; omet le champ d’objet absent | Rejette | Accepte string     |
| `struct.string().null()`     | Rejette                                | Accepte | Accepte string     |
| `struct.string().nullish()`  | Accepte ; omet le champ d’objet absent | Accepte | Accepte string     |
| `struct.null()`              | Rejette                                | Accepte | Rejette les autres |

```typescript twoslash
import { struct } from '@defjs/core'

const Profile = struct.object({
  name: struct.string(),
  nickname: struct.string().optional(),
  biography: struct.string().null(),
  note: struct.string().nullish(),
})

const [error, profile] = struct.parse(Profile, {
  name: 'Ada',
  biography: null,
  note: undefined,
})
if (error) throw error
console.log(profile.name, profile.nickname, profile.biography, profile.note)
```

À la racine, optionnel peut être `undefined`. Dans un objet, les champs optional/nullish omis restent absents. Une entrée en forme de requête utilise des champs ordinaires nommés `path`, `query`, `headers` et `body`. Marque-en un `.optional()` quand l’appelant peut l’omettre. Un champ `body` requis reste requis même si chaque champ à l’intérieur est optionnel.

## Placement de la requête

Path, query, headers et body sont des champs que le builder renvoie, pas un struct de requête. Un `input` déclaré exige toujours un `builder` explicite, même si l’entrée a déjà la forme de la requête. Seules les définitions sans `input` peuvent omettre `builder`. `struct.urlencoded(shape)` et `struct.formData(shape)` sont des structs objet avec un tag de codec. Le tag ne tourne que quand cette valeur est la racine du corps : les clés utilisent les alias, et les tableaux répètent le nom du champ.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createUser = defineRequest({
  method: 'POST',
  path: '/organizations/:organizationId/users',
  input: struct.object({
    path: struct.object({ organizationId: struct.string() }),
    query: struct.object({ notify: struct.boolean().optional() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  builder: (input) => ({
    path: input.path,
    query: input.query,
    headers: input.headers,
    body: input.body,
  }),
})

const command = createUser({
  path: { organizationId: 'acme' },
  query: { notify: true },
  headers: { requestId: 'request-42' },
  body: { displayName: 'Ada' },
})
void command
```

| Racine du corps                              | Envoyé comme      | Content type par défaut                           |
| -------------------------------------------- | ----------------- | ------------------------------------------------- |
| objet typé, tableau, nombre, booléen, `null` | texte JSON        | `application/json`                                |
| struct `string` ou string brute              | texte             | `text/plain;charset=UTF-8`                        |
| `struct.urlencoded(shape)` à la racine       | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `struct.formData(shape)` à la racine         | `FormData`        | boundary multipart de la plateforme               |
| `Blob` / `File`                              | le blob           | type du blob ou `application/octet-stream`        |
| `ArrayBuffer` / view / stream                | octets            | `application/octet-stream`                        |

`struct.file()` est un struct de valeur pour un champ de formulaire et pour un corps fichier brut. Les builders WebSocket ne peuvent pas renvoyer `headers` ni `body`. HTTP et SSE le peuvent. `GET` et `HEAD` non.

## Alias

`.alias(...)` sépare les noms logiques des noms wire. `struct.parse(...)` utilise les clés logiques. Les codecs JSON et de requête plate encodent les alias ; le décodage de réponse JSON ramène les clés wire vers les champs logiques.

```typescript twoslash
import { struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
})

const [parseError, user] = struct.parse(User, { displayName: 'Ada' })
if (parseError) throw parseError
console.log(user.displayName)

const [wireError] = struct.parse(User, { display_name: 'Ada' })
console.log(wireError?.issues[0]?.path)
```

| Frontière                                       | Champ                        |
| ----------------------------------------------- | ---------------------------- |
| `struct.parse(User, ...)` et entrée de commande | `displayName` logique        |
| Objet typé remis au builder                     | `display_name` wire          |
| Décodage JSON / SSE / WebSocket                 | Wire → `displayName` logique |
| Objet anonyme écrit dans le builder             | La clé que tu as écrite      |

Les alias marchent sur les champs imbriqués, les tableaux, les objets, les unions et les discriminateurs. Garde les noms logiques dans le code app ; pose le nom externe sur le struct une fois. Spreader un objet typé garde cet encodage. Poser à la fois le champ logique et sa clé wire dans le même objet est `REQ_BUILD_FAILED`. Un `JSON.stringify` que tu fais toi-même quitte ce chemin : le serializer voit les noms logiques.

Le guide se choisit à chaque nœud, pas seulement à la racine. Un nouvel objet sous un parent anonyme garde les clés que vous avez écrites. Le même objet sous un parent typé utilise le struct de ce champ.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

Quand un guide union correspond à plus d'une branche, chaque branche est encodée puis comparée. Une sortie wire identique est conservée ; une différence est `REQ_BUILD_FAILED`.

Une intersection mixte qui contient une partie non-objet est taguée, à l'analyse, avec la conjonction des tags des parties correspondantes ; une valeur d'intersection mixte écrite à neuf et non analysée reste un objet anonyme.

## Échecs de parse

`struct.parse(...)` renvoie `[null, value]` ou `[StructError, undefined]`. `StructError` étend `Error` et expose `issues`, plus `format()`, `flatten()` et `prettify()`.

```typescript twoslash
import { struct, StructError } from '@defjs/core'

const User = struct.object({ id: struct.number(), name: struct.string() })
const [error, value] = struct.parse(User, { id: 'not-a-number' })

if (error) {
  console.log(error instanceof StructError)
  console.log(error.issues[0]?.code, error.issues[0]?.path)
  console.log(error.flatten().fieldErrors)
  console.log(error.format(), error.prettify())
}
void value
```

Un `StructIssue` a `code`, `expected`, `message`, `path` et `received`. `code` vaut `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` ou `missing_key`. Les issues peuvent contenir de l’entrée non fiable — masque avant de logger ou de renvoyer. `struct.parse(..., { errorMap })` réécrit les messages d’issue pour cet appel seulement.

La validation Struct est seulement structurelle. Pas de règles publiques de range, de format, de refinement, d’auth ou de transition d’état. Fais ces contrôles avant de construire une commande.

## Référence

Constructeurs publics sur `@defjs/core` (les internes ne sont pas des API de façade) :

```typescript twoslash
import { struct } from '@defjs/core'

const Any = struct.any()
const ArrayOfStrings = struct.array(struct.string())
const Bytes = struct.arrayBuffer()
const BigIntValue = struct.bigint()
const BlobValue = struct.blob()
const BooleanValue = struct.boolean()
const DateValue = struct.date()
const Discriminated = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('created'), id: struct.number() }),
  struct.object({ kind: struct.literal('deleted'), id: struct.number() }),
])
const Status = struct.enum(['draft', 'published'])
const FileValue = struct.file()
const Form = struct.formData({ file: struct.file() })
const Combined = struct.intersection(struct.object({ id: struct.number() }), struct.object({ name: struct.string() }))
const Literal = struct.literal('ready')
const NullValue = struct.null()
const NumberValue = struct.number()
const ObjectValue = struct.object({ id: struct.number() })
const Union = struct.or(struct.string(), struct.number())
const RecordValue = struct.record(struct.number())
const StringValue = struct.string()
const Tuple = struct.tuple([struct.string(), struct.number()])
const Unknown = struct.unknown()
const FormUrlEncoded = struct.urlencoded({ name: struct.string() })

void [Any, ArrayOfStrings, Bytes, BigIntValue, BlobValue, BooleanValue, DateValue, Discriminated, Status, FileValue, Form, Combined]
void [Literal, NullValue, NumberValue, ObjectValue, Union, RecordValue, StringValue, Tuple, Unknown, FormUrlEncoded]
```

| Constructeur                     | Entrée                                                       | Sortie inférée                  |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| `struct.number()`                | Nombre autre que `NaN`                                       | `number`, y compris ±`Infinity` |
| `struct.date()`                  | `Date`, nombre, ou string de date                            | `Date` valide                   |
| `struct.bigint()`                | `bigint` ou string acceptée par `BigInt(...)`                | `bigint`                        |
| `struct.enum(...)`               | Membre string ou nombre déclaré                              | Cette union de littéraux        |
| `struct.discriminatedUnion(...)` | Objet avec discriminateur littéral requis                    | Branche objet sélectionnée      |
| `struct.or(...)`                 | Première branche qui matche ; l’encodage vérifie l’ambiguïté | Union des sorties de branches   |
| `struct.intersection(...)`       | Valeurs acceptées par chaque membre                          | Intersection des sorties        |
| `struct.record(value)`           | Objet plat dont les valeurs matchent `value`                 | Record des valeurs parsées      |
| `struct.tuple(items)`            | Tableau d’exactement la longueur déclarée                    | Tuple de longueur fixe          |

Chaque Struct supporte `.alias(name)`, `.optional()`, `.null()` et `.nullish()`. `struct.discriminatedUnion` a besoin d’options objet avec un discriminateur littéral requis et rejette les doublons.

Importe `struct`, `Infer`, `Struct`, `StructError` et les types publics liés depuis `@defjs/core`. Utilise `struct.parse(...)` comme parser. N’importe pas `createObjectStruct`, les symboles de définition, les internes de codec, ni `packages/core/src`.

Non-promesses de la façade :

- Les sorties objet/record utilisent un prototype null — ne suppose pas les méthodes d’`Object.prototype`.
- Les clés d’objet inconnues sont jetées.
- `struct.number()` rejette `NaN`, accepte les infinis.
- `struct.or(...)` essaie les branches dans l’ordre ; rejette les encodages ambigus quand les branches ne s’accordent pas.
- `struct.intersection(...)` parse les membres dans l’ordre de déclaration.
- Une intersection fusionne en profondeur les sorties des membres (les valeurs égales selon `Object.is` et les dates de même instant restent, les plain objects et les tableaux de même longueur fusionnent récursivement, tout autre conflit est `invalid_intersection` à ce path), `unknown` / `any` ne contribuent rien, et une clé logique peut correspondre à plusieurs wire keys ; seules des valeurs inégales écrites sur la même wire key sont un conflit.
- Un Struct valide une frontière ; il ne met pas en cache, n’autorise pas, et ne possède pas une ressource de transport.

## Recettes liées

- [POST JSON](../recipes/post-json.md)
- [GET avec un 404 déclaré](../recipes/get-declared-404.md)
