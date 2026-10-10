---
title: Struct
description: Model request and response shapes, parse unknowns, and encode wire bodies.
---

# Struct

Model a request (and its responses) as Structs. You get TypeScript types via `Infer`, and runtime checks via `struct.parse(...)` — no throw, error-first tuple.

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

Parsed output keeps only declared fields. Missing required fields, wrong primitives, bad nested values, wrong tuple length, or disallowed `null` → `StructError`, no partial value. Structs are immutable; `.optional()` and friends return a new Struct.

## Required, optional, null

Presence and nullability are separate:

| Declaration                  | Missing / `undefined`            | `null` | Valid value         |
| ---------------------------- | -------------------------------- | ------ | ------------------- |
| `struct.string()`            | Reject                           | Reject | Accept string       |
| `struct.string().optional()` | Accept; omit absent object field | Reject | Accept string       |
| `struct.string().null()`     | Reject                           | Accept | Accept string       |
| `struct.string().nullish()`  | Accept; omit absent object field | Accept | Accept string       |
| `struct.null()`              | Reject                           | Accept | Reject other values |

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

At the root, optional can be `undefined`. Inside an object, omitted optional/nullish fields stay absent. A request-shaped input uses ordinary fields named `path`, `query`, `headers`, and `body`. Mark one `.optional()` when the caller may omit it. A required `body` field stays required even when every field inside it is optional.

## Request placement

Path, query, headers, and body are fields the builder returns, not a request struct. A declared `input` always requires an explicit `builder`, even when it already matches the request shape. Only definitions without `input` may omit `builder`. `struct.urlencoded(shape)` and `struct.formData(shape)` are object structs with a codec tag. The tag runs only when that value is the body root: keys use aliases, and arrays repeat the field name.

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

| Body root                                    | Sent as           | Default content type                              |
| -------------------------------------------- | ----------------- | ------------------------------------------------- |
| typed object, array, number, boolean, `null` | JSON text         | `application/json`                                |
| `string` struct or a raw string              | text              | `text/plain;charset=UTF-8`                        |
| `struct.urlencoded(shape)` at the root       | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `struct.formData(shape)` at the root         | `FormData`        | platform multipart boundary                       |
| `Blob` / `File`                              | the blob          | blob type or `application/octet-stream`           |
| `ArrayBuffer` / view / stream                | bytes             | `application/octet-stream`                        |

`struct.file()` is a value struct for a form field and for a raw file body. WebSocket builders cannot return `headers` or `body`. HTTP and SSE can. `GET` and `HEAD` cannot.

## Aliases

`.alias(...)` separates logical names from wire names. `struct.parse(...)` uses logical keys. JSON and flat request codecs encode aliases; JSON response decoding maps wire keys back to logical fields.

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

| Boundary                                    | Field                        |
| ------------------------------------------- | ---------------------------- |
| `struct.parse(User, ...)` and command input | Logical `displayName`        |
| Typed object handed to the builder          | Wire `display_name`          |
| JSON / SSE / WebSocket decoding             | Wire → logical `displayName` |
| Anonymous object written in the builder     | The key you wrote            |

Aliases work on nested fields, arrays, objects, unions, and discriminators. Keep logical names in app code; put the external name on the struct once. Spreading a typed object keeps that encoding. Setting both the logical field and its wire key in the same object is `REQ_BUILD_FAILED`. `JSON.stringify` of a value yourself leaves this path: the serializer sees logical names.

The guide is chosen at every node, not only at the root. A new object under an anonymous parent keeps the keys you wrote. The same object under a typed parent uses that field's struct.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

When a union guide matches more than one branch, each branch is encoded and compared. Identical wire output is kept; a difference is `REQ_BUILD_FAILED`.

A mixed intersection that contains a non-object part is tagged, when parsed, with the conjunction of the tags from the parts that matched; a newly written mixed-intersection value that was not parsed is an anonymous object.

## Parse failures

`struct.parse(...)` returns `[null, value]` or `[StructError, undefined]`. `StructError` extends `Error` and exposes `issues`, plus `format()`, `flatten()`, and `prettify()`.

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

A `StructIssue` has `code`, `expected`, `message`, `path`, and `received`. `code` is `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, or `missing_key`. Issues can hold untrusted input — redact before logging or returning. `struct.parse(..., { errorMap })` rewrites issue messages for that call only.

Struct validation is structural only. No public range, format, refinement, auth, or state-transition rules. Do those checks before you build a command.

## Reference

Public constructors on `@defjs/core` (internals are not facade APIs):

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

| Constructor                      | Input                                            | Inferred output                 |
| -------------------------------- | ------------------------------------------------ | ------------------------------- |
| `struct.number()`                | Number other than `NaN`                          | `number`, including ±`Infinity` |
| `struct.date()`                  | `Date`, number, or date string                   | Valid `Date`                    |
| `struct.bigint()`                | `bigint` or string accepted by `BigInt(...)`     | `bigint`                        |
| `struct.enum(...)`               | Declared string or number member                 | That literal union              |
| `struct.discriminatedUnion(...)` | Object with required literal discriminator       | Selected object branch          |
| `struct.or(...)`                 | First matching branch; encoding checks ambiguity | Union of branch outputs         |
| `struct.intersection(...)`       | Values accepted by every member                  | Intersection of outputs         |
| `struct.record(value)`           | Plain object whose values match `value`          | Record of parsed values         |
| `struct.tuple(items)`            | Array of exactly the declared length             | Fixed-length tuple              |

Every Struct supports `.alias(name)`, `.optional()`, `.null()`, and `.nullish()`. `struct.discriminatedUnion` needs object options with a required literal discriminator and rejects duplicates.

Import `struct`, `Infer`, `Struct`, `StructError`, and related public types from `@defjs/core`. Use `struct.parse(...)` as the parser. Don’t import `createObjectStruct`, definition symbols, codec internals, or `packages/core/src`.

Facade non-promises:

- Object/record outputs use a null prototype — don’t assume `Object.prototype` methods.
- Unknown object keys are dropped.
- `struct.number()` rejects `NaN`, accepts infinities.
- `struct.or(...)` tries branches in order; rejects ambiguous encodings when branches disagree.
- `struct.intersection(...)` parses members in declaration order.
- An intersection deep-merges member outputs (`Object.is`-equal values and equal-time dates stay, plain objects and equal-length arrays merge recursively, any other clash is `invalid_intersection` at that path), `unknown`/`any` contribute nothing, and one logical key may map to several wire keys. Only unequal values written to the same wire key conflict.
- A Struct validates a boundary; it doesn’t cache, authorize, or own a transport resource.

## Related recipes

- [POST JSON](../recipes/post-json.md)
- [GET with a declared 404](../recipes/get-declared-404.md)
