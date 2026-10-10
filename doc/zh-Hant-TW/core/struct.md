---
title: Struct
description: 建模請求與回應形狀、剖析 unknowns，並編碼 wire bodies。
---

# Struct

把請求（與其回應）建成 Structs。你透過 `Infer` 拿到 TypeScript 型別，透過 `struct.parse(...)` 做執行階段檢查 — 不 throw，error-first tuple。

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

剖析輸出只保留已宣告欄位。缺少必填欄位、錯誤的 primitives、壞的巢狀值、錯誤的 tuple 長度，或不允許的 `null` → `StructError`，沒有部分值。Structs 不可變；`.optional()` 與同類方法回傳新的 Struct。

## 必填、optional、null

Presence 與 nullability 是分開的：

| 宣告                         | 缺少／`undefined`            | `null` | 有效值      |
| ---------------------------- | ---------------------------- | ------ | ----------- |
| `struct.string()`            | 拒絕                         | 拒絕   | 接受 string |
| `struct.string().optional()` | 接受；省略物件中不存在的欄位 | 拒絕   | 接受 string |
| `struct.string().null()`     | 拒絕                         | 接受   | 接受 string |
| `struct.string().nullish()`  | 接受；省略物件中不存在的欄位 | 接受   | 接受 string |
| `struct.null()`              | 拒絕                         | 接受   | 拒絕其他值  |

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

在根層，optional 可以是 `undefined`。在物件裡，省略的 optional／nullish 欄位維持不存在。Request 形狀的 input 用名為 `path`、`query`、`headers`、`body` 的一般欄位。呼叫端可以省略時，把該欄位標成 `.optional()`。`body` 欄位若是必填，就算裡面每個欄位都是 optional，它仍是必填。

## 放置 request

Path、query、headers、body 是 builder 回傳的欄位，不是一個 request struct。只要宣告了 `input`，就必須明確提供 `builder`，即使輸入已經是請求形狀也一樣。只有沒有 `input` 的定義可以省略 `builder`。`struct.urlencoded(shape)` 與 `struct.formData(shape)` 是帶 codec tag 的物件 struct。Tag 只有在該值是 body 根時才跑：keys 用 aliases，陣列會重複欄位名稱。

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

| Body 根                                         | 送出形式          | 預設 content type                                 |
| ----------------------------------------------- | ----------------- | ------------------------------------------------- |
| 型別化的 object、array、number、boolean、`null` | JSON 文字         | `application/json`                                |
| `string` struct 或原始字串                      | 文字              | `text/plain;charset=UTF-8`                        |
| 根上的 `struct.urlencoded(shape)`               | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| 根上的 `struct.formData(shape)`                 | `FormData`        | 平台 multipart boundary                           |
| `Blob`／`File`                                  | 該 blob           | blob type 或 `application/octet-stream`           |
| `ArrayBuffer`／view／stream                     | bytes             | `application/octet-stream`                        |

`struct.file()` 是給 form 欄位與裸 file body 用的值 struct。WebSocket builder 不能回傳 `headers` 或 `body`。HTTP 與 SSE 可以。`GET` 與 `HEAD` 不行。

## Aliases

`.alias(...)` 把邏輯名稱與 wire 名稱分開。`struct.parse(...)` 用邏輯 keys。JSON 與 flat request codecs 會編碼 aliases；JSON 回應解碼把 wire keys 映回邏輯欄位。

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

| 邊界                                       | 欄位                      |
| ------------------------------------------ | ------------------------- |
| `struct.parse(User, ...)` 與 command input | 邏輯 `displayName`        |
| 交給 builder 的型別化物件                  | Wire `display_name`       |
| JSON／SSE／WebSocket 解碼                  | Wire → 邏輯 `displayName` |
| Builder 裡寫的匿名物件                     | 你寫下的那個 key          |

Aliases 可作用在巢狀欄位、arrays、objects、unions、discriminators。應用程式碼用邏輯名稱；外部名稱在 struct 上宣告一次。展開型別化物件會保留那套編碼。在同一個物件裡同時設定邏輯欄位和它的 wire key 是 `REQ_BUILD_FAILED`。自己對值做 `JSON.stringify` 就離開這條路徑：serializer 看到的是邏輯名稱。

引導在每個節點決定，不只在根上。匿名父物件底下新寫的物件保留你寫下的 key。帶型別的父物件底下，同一個物件改用該欄位的 struct。

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union 引導同時命中多個分支時，每個分支都編碼再比較。線上結果一致就採用；有差異就是 `REQ_BUILD_FAILED`。

混合 intersection（包含非 object 部分）解析時，標籤是各匹配部分既有標籤的合取；未經解析、新寫的混合 intersection 值按匿名物件處理。

## 剖析失敗

`struct.parse(...)` 回傳 `[null, value]` 或 `[StructError, undefined]`。`StructError` 繼承 `Error`，並暴露 `issues`，以及 `format()`、`flatten()`、`prettify()`。

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

`StructIssue` 有 `code`、`expected`、`message`、`path`、`received`。`code` 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union` 或 `missing_key`。Issues 可能持有不可信 input — 記錄或回傳前先遮罩。`struct.parse(..., { errorMap })` 只覆蓋那一次 parse 的文案。

Struct 驗證只做結構。沒有公開的 range、format、refinement、auth 或狀態轉移規則。那些檢查在建 command 之前做。

## Reference

`@defjs/core` 上的公開 constructors（internals 不是 facade API）：

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

| Constructor                      | Input                                   | 推導輸出                 |
| -------------------------------- | --------------------------------------- | ------------------------ |
| `struct.number()`                | 非 `NaN` 的 Number                      | `number`，含 ±`Infinity` |
| `struct.date()`                  | `Date`、number 或 date string           | 有效的 `Date`            |
| `struct.bigint()`                | `bigint` 或 `BigInt(...)` 接受的 string | `bigint`                 |
| `struct.enum(...)`               | 已宣告的 string 或 number member        | 該 literal union         |
| `struct.discriminatedUnion(...)` | 帶必填 literal discriminator 的物件     | 選定的 object 分支       |
| `struct.or(...)`                 | 第一個相符分支；編碼會檢查歧義          | 分支輸出的 union         |
| `struct.intersection(...)`       | 每個 member 都接受的值                  | 輸出的 intersection      |
| `struct.record(value)`           | 值符合 `value` 的 plain object          | 剖析後值的 Record        |
| `struct.tuple(items)`            | 長度恰好為宣告長度的陣列                | 固定長度 tuple           |

每個 Struct 都支援 `.alias(name)`、`.optional()`、`.null()`、`.nullish()`。`struct.discriminatedUnion` 需要帶必填 literal discriminator 的 object options，並拒絕重複。

從 `@defjs/core` 匯入 `struct`、`Infer`、`Struct`、`StructError` 與相關公開型別。用 `struct.parse(...)` 當 parser。別匯入 `createObjectStruct`、definition symbols、codec internals，或 `packages/core/src`。

Facade 的非 promise 注意事項：

- Object／record 輸出用 null prototype — 別假設有 `Object.prototype` 方法。
- 未知的物件 keys 會被丟掉。
- `struct.number()` 拒絕 `NaN`，接受 infinities。
- `struct.or(...)` 依序試分支；分支不同意時拒絕歧義編碼。
- `struct.intersection(...)` 依宣告順序剖析 members。
- intersection 會深合併 members 的輸出（`Object.is` 相等的值與時間相同的 Date 保留，plain objects 與等長 arrays 遞迴合併，其餘衝突是該 path 上的 `invalid_intersection`），`unknown` / `any` 不貢獻輸出，同一個邏輯 key 可以對應多個 wire key；只有同一個 wire key 上寫入了不相等的值才是衝突。
- Struct 驗證邊界；它不會快取、授權，或擁有傳輸資源。

## 相關 recipes

- [POST JSON](../recipes/post-json.md)
- [已宣告 404 的 GET](../recipes/get-declared-404.md)
