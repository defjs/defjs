---
title: Struct
description: Request- und Response-Shapes modellieren, Unknowns parsen und Wire-Bodies encoden.
---

# Struct

Modele einen Request (und seine Responses) als Structs. Du bekommst TypeScript-Types via `Infer` und Runtime-Checks via `struct.parse(...)` — kein Throw, Error-first-Tupel.

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

Geparster Output behält nur deklarierte Fields. Fehlende required Fields, falsche Primitives, schlechte nested Values, falsche Tuple-Length oder disallowed `null` → `StructError`, kein partial Value. Structs sind immutable; `.optional()` und Friends geben einen neuen Struct zurück.

## Required, optional, null

Presence und Nullability sind getrennt:

| Declaration                  | Missing / `undefined`                 | `null` | Valid Value            |
| ---------------------------- | ------------------------------------- | ------ | ---------------------- |
| `struct.string()`            | Reject                                | Reject | Accept String          |
| `struct.string().optional()` | Accept; absent Object-Field weglassen | Reject | Accept String          |
| `struct.string().null()`     | Reject                                | Accept | Accept String          |
| `struct.string().nullish()`  | Accept; absent Object-Field weglassen | Accept | Accept String          |
| `struct.null()`              | Reject                                | Accept | Andere Values rejecten |

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

Am Root kann optional `undefined` sein. Innerhalb eines Objects bleiben weggelassene optional/nullish Fields absent. Ein request-förmiger Input nutzt gewöhnliche Fields namens `path`, `query`, `headers` und `body`. Markiere eines `.optional()`, wenn der Caller es weglassen darf. Ein required `body`-Field bleibt required, auch wenn jedes Field darin optional ist.

## Request-Platzierung

Path, Query, Headers und Body sind Fields, die der Builder zurückgibt, kein Request-Struct. Lass `builder` weg, wenn `input` diese Shape schon hat. `struct.urlencoded(shape)` und `struct.formData(shape)` sind Object-Structs mit einem Codec-Tag. Der Tag läuft nur, wenn dieser Wert der Body-Root ist: Keys nutzen Aliasse, und Arrays wiederholen den Field-Namen.

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
})

const command = createUser({
  path: { organizationId: 'acme' },
  query: { notify: true },
  headers: { requestId: 'request-42' },
  body: { displayName: 'Ada' },
})
void command
```

| Body-Root                                          | Gesendet als      | Default Content-Type                              |
| -------------------------------------------------- | ----------------- | ------------------------------------------------- |
| typisiertes Object, Array, Number, Boolean, `null` | JSON-Text         | `application/json`                                |
| `string`-Struct oder ein Raw-String                | Text              | `text/plain;charset=UTF-8`                        |
| `struct.urlencoded(shape)` am Root                 | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `struct.formData(shape)` am Root                   | `FormData`        | Platform-Multipart-Boundary                       |
| `Blob` / `File`                                    | der Blob          | Blob-Type oder `application/octet-stream`         |
| `ArrayBuffer` / View / Stream                      | Bytes             | `application/octet-stream`                        |

`struct.file()` ist ein Value-Struct für ein Form-Field und für einen Raw-File-Body. WebSocket-Builder können weder `headers` noch `body` zurückgeben. HTTP und SSE können. `GET` und `HEAD` nicht.

## Aliasse

`.alias(...)` trennt logische Namen von Wire-Namen. `struct.parse(...)` nutzt logische Keys. JSON und flat Request-Codecs encoden Aliasse; JSON-Response-Decoding mappt Wire-Keys zurück auf logische Fields.

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

| Boundary                                           | Field                            |
| -------------------------------------------------- | -------------------------------- |
| `struct.parse(User, ...)` und Command-Input        | Logisches `displayName`          |
| Typisiertes Object, das dem Builder übergeben wird | Wire `display_name`              |
| JSON- / SSE- / WebSocket-Decoding                  | Wire → logisches `displayName`   |
| Anonymes Object, im Builder geschrieben            | Der Key, den du geschrieben hast |

Aliasse funktionieren auf nested Fields, Arrays, Objects, Unions und Discriminators. Halte logische Namen im App-Code; packe den externen Namen einmal auf den Struct. Ein typisiertes Object zu spreaden behält dieses Encoding. Logisches Field und seinen Wire-Key im selben Object zu setzen ist `REQ_BUILD_FAILED`. `JSON.stringify` eines Werts, den du selbst serialisierst, verlässt diesen Pfad: der Serializer sieht logische Namen.

Der Guide wird an jedem Knoten gewählt, nicht nur an der Wurzel. Ein neues Object unter einem anonymen Parent behält die Keys, die du geschrieben hast. Dasselbe Object unter einem typisierten Parent nutzt den Struct dieses Fields.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

Trifft ein Union-Guide mehr als einen Branch, wird jeder Branch kodiert und verglichen. Identische Wire-Ausgabe bleibt; ein Unterschied ist `REQ_BUILD_FAILED`.

Eine gemischte Intersection, die einen Nicht-Objekt-Teil enthält, bekommt beim Parsen als Tag die Konjunktion der Tags der passenden Teile; ein neu geschriebener Mixed-Intersection-Wert, der nicht geparst wurde, bleibt ein anonymes Object.

## Parse-Failures

`struct.parse(...)` gibt `[null, value]` oder `[StructError, undefined]` zurück. `StructError` extends `Error` und exponiert `issues`, plus `format()`, `flatten()` und `prettify()`.

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

Ein `StructIssue` hat `code`, `expected`, `message`, `path` und `received`. `code` ist `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` oder `missing_key`. Issues können untrusted Input halten — redact vor Logging oder Return. `struct.parse(..., { errorMap })` schreibt Issue-Messages nur für diesen Call um.

Struct-Validierung ist nur strukturell. Keine öffentlichen Range-, Format-, Refinement-, Auth- oder State-Transition-Rules. Mach diese Checks, bevor du einen Command baust.

## Reference

Öffentliche Constructors auf `@defjs/core` (Internals sind keine Facade-APIs):

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

| Constructor                      | Input                                             | Inferierter Output              |
| -------------------------------- | ------------------------------------------------- | ------------------------------- |
| `struct.number()`                | Number außer `NaN`                                | `number`, inklusive ±`Infinity` |
| `struct.date()`                  | `Date`, Number oder Date-String                   | Gültiges `Date`                 |
| `struct.bigint()`                | `bigint` oder String akzeptiert von `BigInt(...)` | `bigint`                        |
| `struct.enum(...)`               | Deklariertes String- oder Number-Member           | Diese Literal-Union             |
| `struct.discriminatedUnion(...)` | Object mit required Literal-Discriminator         | Gewählter Object-Branch         |
| `struct.or(...)`                 | Erster matching Branch; Encoding prüft Ambiguity  | Union der Branch-Outputs        |
| `struct.intersection(...)`       | Values akzeptiert von jedem Member                | Intersection der Outputs        |
| `struct.record(value)`           | Plain Object, dessen Values `value` matchen       | Record der geparsten Values     |
| `struct.tuple(items)`            | Array exakt der deklarierten Length               | Fixed-Length-Tuple              |

Jeder Struct unterstützt `.alias(name)`, `.optional()`, `.null()` und `.nullish()`. `struct.discriminatedUnion` braucht Object-Options mit required Literal-Discriminator und rejectet Duplicates.

Importiere `struct`, `Infer`, `Struct`, `StructError` und verwandte öffentliche Types aus `@defjs/core`. Nutze `struct.parse(...)` als Parser. Importiere nicht `createObjectStruct`, Definition-Symbols, Codec-Internals oder `packages/core/src`.

Facade Non-Promises:

- Object-/Record-Outputs nutzen Null-Prototype — nimm `Object.prototype`-Methods nicht an.
- Unknown Object-Keys werden gedroppt.
- `struct.number()` rejectet `NaN`, akzeptiert Infinities.
- `struct.or(...)` versucht Branches in Order; rejectet ambiguous Encodings, wenn Branches disagree.
- `struct.intersection(...)` parst Members in Declaration-Order.
- Eine Intersection merged Member-Outputs tief (`Object.is`-gleiche Werte und Dates mit gleicher Zeit bleiben, plain objects und gleich lange Arrays mergen rekursiv, jeder andere Clash ist `invalid_intersection` an diesem Path), `unknown`/`any` tragen nichts bei, und ein logischer Key kann mehreren Wire-Keys entsprechen; nur ungleiche Werte auf demselben Wire-Key sind ein Konflikt.
- Ein Struct validiert eine Grenze; er cached nicht, authorisiert nicht und besitzt keine Transport-Resource.

## Verwandte Rezepte

- [POST JSON](../recipes/post-json.md)
- [GET mit deklariertem 404](../recipes/get-declared-404.md)
