---
title: Struct
description: Model request 同 response shapes，parse unknowns，再 encode wire bodies。
---

# Struct

用 Structs model 一個 request（同佢嘅 responses）。你透過 `Infer` 拎 TypeScript types，再用 `struct.parse(...)` 做 runtime checks — 唔 throw，error-first tuple。

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

Parsed output 淨係保留 declared fields。Missing required fields、wrong primitives、bad nested values、wrong tuple length，或者 disallowed `null` → `StructError`，冇 partial value。Structs 係 immutable；`.optional()` 同朋友會 return 新 Struct。

## Required、optional、null

Presence 同 nullability 係分開嘅：

| Declaration                  | Missing / `undefined`            | `null` | Valid value         |
| ---------------------------- | -------------------------------- | ------ | ------------------- |
| `struct.string()`            | Reject                           | Reject | Accept string       |
| `struct.string().optional()` | Accept；omit absent object field | Reject | Accept string       |
| `struct.string().null()`     | Reject                           | Accept | Accept string       |
| `struct.string().nullish()`  | Accept；omit absent object field | Accept | Accept string       |
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

喺 root，optional 可以係 `undefined`。喺 object 入面，omitted optional/nullish fields 保持 absent。Request-shaped input 用普通 fields，名叫 `path`、`query`、`headers` 同 `body`。Caller 可以 omit 嗰個就 mark `.optional()`。`body` field required 就仍然 required，即使入面每個 field 都 optional。

## Request placement

Path、query、headers 同 body 係 builder return 嘅 fields，唔係一個 request struct。只要聲明咗 `input`，就必須明確提供 `builder`，即使 input 已經係 request shape 都一樣。只有冇 `input` 嘅定義先可以省略 `builder`。`struct.urlencoded(shape)` 同 `struct.formData(shape)` 係帶 codec tag 嘅 object structs。個 tag 只會喺個 value 係 body root 嘅時候 run：keys 用 aliases，arrays 會重複 field name。

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

| Body root                                    | 送出點樣          | Default content type                              |
| -------------------------------------------- | ----------------- | ------------------------------------------------- |
| typed object、array、number、boolean、`null` | JSON text         | `application/json`                                |
| `string` struct 或者 raw string              | text              | `text/plain;charset=UTF-8`                        |
| root 嘅 `struct.urlencoded(shape)`           | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| root 嘅 `struct.formData(shape)`             | `FormData`        | platform multipart boundary                       |
| `Blob` / `File`                              | 嗰個 blob         | blob type 或者 `application/octet-stream`         |
| `ArrayBuffer` / view / stream                | bytes             | `application/octet-stream`                        |

`struct.file()` 係 form field 同 raw file body 用嘅 value struct。WebSocket builders 唔可以 return `headers` 或者 `body`。HTTP 同 SSE 可以。`GET` 同 `HEAD` 唔可以。

## Aliases

`.alias(...)` 分開 logical names 同 wire names。`struct.parse(...)` 用 logical keys。JSON 同 flat request codecs encode aliases；JSON response decoding 會將 wire keys map 返去 logical fields。

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

| Boundary                                   | Field                        |
| ------------------------------------------ | ---------------------------- |
| `struct.parse(User, ...)` 同 command input | Logical `displayName`        |
| 交畀 builder 嘅 typed object               | Wire `display_name`          |
| JSON / SSE / WebSocket decoding            | Wire → logical `displayName` |
| Builder 入面手寫嘅 anonymous object        | 你寫嘅嗰個 key               |

Aliases 對 nested fields、arrays、objects、unions 同 discriminators 都有效。App code 用 logical names；external name 喺 struct 上面放一次。Spread 一個 typed object 會保留嗰種 encoding。同一個 object 同時 set logical field 同佢嘅 wire key 就係 `REQ_BUILD_FAILED`。你自己 `JSON.stringify` 一個 value 就離開呢條路：serializer 見到嘅係 logical names。

引導喺每個節點決定，唔只喺 root。Anonymous parent 下面新寫嘅 object 保留你寫落嘅 key。Typed parent 下面，同一個 object 改用嗰個 field 嘅 struct。

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union 引導同時 match 多過一個 branch 嘅時候，每個 branch 都 encode 再比較。Wire 結果一樣就採用；有分別就係 `REQ_BUILD_FAILED`。

混合 intersection（包含非 object 部分）解析嗰陣，標籤係各匹配部分已有標籤嘅合取；未經解析、新寫嘅混合 intersection 值就當匿名 object 處理。

## Parse failures

`struct.parse(...)` return `[null, value]` 或者 `[StructError, undefined]`。`StructError` extends `Error`，暴露 `issues`，再加 `format()`、`flatten()` 同 `prettify()`。

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

`StructIssue` 有 `code`、`expected`、`message`、`path` 同 `received`。`code` 係 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或者 `missing_key`。Issues 可以持有 untrusted input — log 或者 return 之前先 redact。`struct.parse(..., { errorMap })` 只改寫嗰一次 call 嘅 issue messages。

Struct validation 淨係 structural。冇 public range、format、refinement、auth 或者 state-transition rules。嗰啲 checks 喺你 build command 之前自己做。

## Reference

`@defjs/core` 上嘅 public constructors（internals 唔係 facade APIs）：

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

| Constructor                      | Input                                               | Inferred output            |
| -------------------------------- | --------------------------------------------------- | -------------------------- |
| `struct.number()`                | 除咗 `NaN` 以外嘅 number                            | `number`，包括 ±`Infinity` |
| `struct.date()`                  | `Date`、number，或者 date string                    | Valid `Date`               |
| `struct.bigint()`                | `bigint` 或者 `BigInt(...)` 接受嘅 string           | `bigint`                   |
| `struct.enum(...)`               | Declared string 或者 number member                  | 嗰個 literal union         |
| `struct.discriminatedUnion(...)` | 帶 required literal discriminator 嘅 object         | Selected object branch     |
| `struct.or(...)`                 | 第一個 matching branch；encoding 會 check ambiguity | Branch outputs 嘅 union    |
| `struct.intersection(...)`       | 每個 member 都接受嘅 values                         | Outputs 嘅 intersection    |
| `struct.record(value)`           | Values 符合 `value` 嘅 plain object                 | Parsed values 嘅 record    |
| `struct.tuple(items)`            | Exactly declared length 嘅 array                    | Fixed-length tuple         |

每個 Struct 都支援 `.alias(name)`、`.optional()`、`.null()` 同 `.nullish()`。`struct.discriminatedUnion` 要有 required literal discriminator 嘅 object options，並 reject duplicates。

由 `@defjs/core` import `struct`、`Infer`、`Struct`、`StructError` 同 related public types。用 `struct.parse(...)` 做 parser。唔好 import `createObjectStruct`、definition symbols、codec internals，或者 `packages/core/src`。

Facade non-promises：

- Object/record outputs 用 null prototype — 唔好假設有 `Object.prototype` methods。
- Unknown object keys 會被 drop。
- `struct.number()` reject `NaN`，accept infinities。
- `struct.or(...)` 按次序試 branches；branches 意見唔同時 reject ambiguous encodings。
- `struct.intersection(...)` 按 declaration order parse members。
- intersection 會 deep-merge members 嘅 outputs（`Object.is` 相等嘅 values 同時間相同嘅 Date 保留，plain objects 同等長 arrays 遞迴 merge，其他衝突係該 path 嘅 `invalid_intersection`），`unknown` / `any` 唔貢獻 output，同一個 logical key 可以對應多個 wire key；只有同一個 wire key 上面寫入咗唔相等嘅值先算衝突。
- Struct validate 一個 boundary；佢唔會 cache、authorize，或者 own transport resource。

## Related recipes

- [POST JSON](../recipes/post-json.md)
- [GET with a declared 404](../recipes/get-declared-404.md)
