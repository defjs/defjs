---
title: Struct
description: リクエストとレスポンスの形をモデルし、未知の値をパースし、ワイヤボディをエンコードします。
---

# Struct

リクエスト（とそのレスポンス）を Struct としてモデルします。TypeScript の型は `Infer` から、実行時チェックは `struct.parse(...)` から得られます — throw せず、エラーファーストのタプルです。

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

パース結果に残るのは宣言したフィールドだけです。必須フィールドの欠落、プリミティブの不一致、壊れた入れ子、タプル長の不一致、許されない `null` → `StructError` で、部分的な値はありません。Struct は不変です。`.optional()` などは新しい Struct を返します。

## 必須、任意、null

存在と null 許容は別です。

| 宣言                         | 欠落 / `undefined`                           | `null`     | 妥当な値           |
| ---------------------------- | -------------------------------------------- | ---------- | ------------------ |
| `struct.string()`            | 拒否                                         | 拒否       | 文字列を受け付ける |
| `struct.string().optional()` | 受け付ける。無いオブジェクトフィールドは省略 | 拒否       | 文字列を受け付ける |
| `struct.string().null()`     | 拒否                                         | 受け付ける | 文字列を受け付ける |
| `struct.string().nullish()`  | 受け付ける。無いオブジェクトフィールドは省略 | 受け付ける | 文字列を受け付ける |
| `struct.null()`              | 拒否                                         | 受け付ける | 他の値は拒否       |

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

ルートでは optional は `undefined` になれます。オブジェクト内では、省略された optional/nullish フィールドは欠落のままです。リクエスト形の入力は、`path`、`query`、`headers`、`body` という普通のフィールドを使います。呼び出し側が省いてよいものは `.optional()` を付けます。中のフィールドがすべて optional でも、必須の `body` フィールドは必須のままです。

## リクエストへの配置

path、query、headers、body はビルダーが返すフィールドであり、リクエスト struct ではありません。`input` を宣言した定義では、入力がすでにリクエストの形でも、明示的な `builder` が必須です。`builder` を省略できるのは `input` がない定義だけです。`struct.urlencoded(shape)` と `struct.formData(shape)` は、コーデックタグ付きのオブジェクト struct です。タグが走るのは、その値がボディのルートであるときだけです。キーはエイリアスを使い、配列はフィールド名を繰り返します。

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

| ボディのルート                                  | 送られるもの      | デフォルトの content type                         |
| ----------------------------------------------- | ----------------- | ------------------------------------------------- |
| 型付きの object、array、number、boolean、`null` | JSON テキスト     | `application/json`                                |
| `string` struct、または生の文字列               | テキスト          | `text/plain;charset=UTF-8`                        |
| ルートの `struct.urlencoded(shape)`             | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| ルートの `struct.formData(shape)`               | `FormData`        | プラットフォームの multipart boundary             |
| `Blob` / `File`                                 | その blob         | blob の type、または `application/octet-stream`   |
| `ArrayBuffer` / view / stream                   | バイト列          | `application/octet-stream`                        |

`struct.file()` は、フォームフィールド用と生のファイルボディ用の値 struct です。WebSocket のビルダーは `headers` も `body` も返せません。HTTP と SSE は返せます。`GET` と `HEAD` は返せません。

## エイリアス

`.alias(...)` は論理名とワイヤ名を分けます。`struct.parse(...)` は論理キーを使います。JSON とフラットなリクエストコーデックはエイリアスをエンコードし、JSON レスポンスのデコードはワイヤキーを論理フィールドへ戻します。

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

| 境界                                     | フィールド                    |
| ---------------------------------------- | ----------------------------- |
| `struct.parse(User, ...)` とコマンド入力 | 論理名 `displayName`          |
| ビルダーに渡した型付きオブジェクト       | ワイヤ名 `display_name`       |
| JSON / SSE / WebSocket のデコード        | ワイヤ → 論理名 `displayName` |
| ビルダー内で書いた匿名オブジェクト       | 自分で書いたキー              |

エイリアスは入れ子フィールド、配列、オブジェクト、ユニオン、判別子で効きます。アプリコードでは論理名を保ち、外部名は struct に一度だけ置いてください。型付きオブジェクトをスプレッドすると、そのエンコードが保たれます。同じオブジェクトに論理フィールドとそのワイヤキーの両方を置くと `REQ_BUILD_FAILED` です。値を自分で `JSON.stringify` するとこの経路から外れます。シリアライザが見るのは論理名です。

ガイドはルートだけでなく、各ノードで決まります。匿名の親の下に新しく書いたオブジェクトは、書いたキーのままです。型付きの親の下では、同じオブジェクトがそのフィールドの struct を使います。

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union のガイドが複数の分岐に一致したら、分岐ごとにエンコードして比較します。ワイヤ結果が同じならそれを採用し、違えば `REQ_BUILD_FAILED` です。

非 object 部分を含む混合 intersection は、解析時に一致した各部分のタグの連言をタグとして付け、解析せず新しく書いた値は匿名オブジェクトとして扱います。

## パースの失敗

`struct.parse(...)` は `[null, value]` か `[StructError, undefined]` を返します。`StructError` は `Error` を拡張し、`issues` に加えて `format()`、`flatten()`、`prettify()` を持ちます。

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

`StructIssue` は `code`、`expected`、`message`、`path`、`received` を持ちます。`code` は `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union`、`missing_key` のいずれかです。issue には信頼できない入力が入り得ます — ログや返却の前に redact してください。`struct.parse(..., { errorMap })` は、その呼び出しだけの issue メッセージを書き換えます。

Struct の検証は構造だけです。公開された範囲、形式、refinement、認証、状態遷移の規則はありません。そうした検査はコマンドを作る前に行ってください。

## Reference

`@defjs/core` の公開コンストラクタです（内部はファサード API ではありません）。

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

| コンストラクタ                   | 入力                                              | 推論される出力              |
| -------------------------------- | ------------------------------------------------- | --------------------------- |
| `struct.number()`                | `NaN` 以外の数値                                  | ±`Infinity` を含む `number` |
| `struct.date()`                  | `Date`、数値、または日付文字列                    | 妥当な `Date`               |
| `struct.bigint()`                | `bigint`、または `BigInt(...)` が受け付ける文字列 | `bigint`                    |
| `struct.enum(...)`               | 宣言した文字列または数値のメンバー                | そのリテラルユニオン        |
| `struct.discriminatedUnion(...)` | 必須のリテラル判別子を持つオブジェクト            | 選ばれたオブジェクトの枝    |
| `struct.or(...)`                 | 最初に一致した枝。エンコードは曖昧さを検査する    | 枝の出力のユニオン          |
| `struct.intersection(...)`       | すべてのメンバーが受け付ける値                    | 出力の交差                  |
| `struct.record(value)`           | 値が `value` に合うプレーンオブジェクト           | パース済み値のレコード      |
| `struct.tuple(items)`            | 宣言した長さちょうどの配列                        | 固定長タプル                |

すべての Struct は `.alias(name)`、`.optional()`、`.null()`、`.nullish()` をサポートします。`struct.discriminatedUnion` は、必須のリテラル判別子を持つオブジェクトの選択肢が必要で、重複は拒否します。

`struct`、`Infer`、`Struct`、`StructError`、関連する公開型は `@defjs/core` から import してください。パーサーは `struct.parse(...)` です。`createObjectStruct`、定義の symbol、コーデック内部、`packages/core/src` は import しないでください。

ファサードが約束しないこと:

- オブジェクト/レコードの出力は null プロトタイプです — `Object.prototype` のメソッドを前提にしないでください。
- 未知のオブジェクトキーは落とされます。
- `struct.number()` は `NaN` を拒否し、無限大は受け付けます。
- `struct.or(...)` は枝を順に試します。枝のエンコードが食い違うときは曖昧なエンコードを拒否します。
- `struct.intersection(...)` は宣言順にメンバーをパースします。
- intersection はメンバー出力を深くマージします（`Object.is` で等しい値と同時刻の Date はそのまま、plain object と長さが同じ配列は再帰的にマージ、それ以外の衝突はその path の `invalid_intersection`）。`unknown` / `any` は出力に寄与しません。一つの論理キーは複数の wire key に対応できます。同じ wire key に等しくない値が書かれたときだけ衝突です。
- Struct は境界を検証します。キャッシュも認可も、トランスポート資源の所有もしません。

## 関連レシピ

- [POST JSON](../recipes/post-json.md)
- [宣言済み 404 付きの GET](../recipes/get-declared-404.md)
