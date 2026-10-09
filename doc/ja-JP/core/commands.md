---
title: Commands
description: エンドポイントを定義し、不透明なコマンドを組み立て、入力を写し、トランスポート結果を推論します。
---

# Commands

定義 1 つ → エンドポイント → 不透明なコマンド → `client.execute`。HTTP、SSE、WebSocket で同じパイプラインです。

## Basic Setup

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## 定義を選ぶ

| 定義                     | 契約                                                           | 成功時の値                                       |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------ |
| `defineRequest(...)`     | method、相対 path、任意の input、任意の `output` / `error`     | デコード済みデータ + レスポンス                  |
| `defineEventStream(...)` | path、バッファ/キュー上限、イベント名 → Struct のマップ        | `EventStreamHandle` + open スナップショット      |
| `defineWebSocket(...)`   | path、incoming struct 1 つ、任意の outgoing struct、キュー上限 | `WebSocketSession` + connection スナップショット |

`input` が無い → エンドポイントは引数を取らず、`builder` は `() => request` でも構いません。`input` がある → struct の値を渡します。任意フィールドは省略でき、必須フィールドは省略できません。

コマンドは不透明なままにしてください。タグや symbol を掘らないでください。

## 値の行き先

struct が値のエンコード方法を決めます。`builder` が行き先を決めます。`builder` は**パース済み**入力の、同期的で純粋な関数です。execute のときに走ります。throw するとタプル上の `REQ_BUILD_FAILED` になります — エンドポイント呼び出し自体は throw しません。

入力 struct がすでに `{ path?, query?, headers?, body? }` なら `builder` は省きます。それは恒等の `(input) => input` です。パース済み入力がその形に代入できないとき、TypeScript は `builder` を要求します。

型付きの値をそのまま渡してください。エイリアス、`Date` → ISO、`bigint` → 文字列は、その struct が使われるあらゆる場所で適用されます。リクエストへの配置、レスポンスのデコード、SSE イベント、WebSocket フレームです。

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
  email: struct.string(),
})

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({ user: User }),
  builder: (input) => ({ body: input.user }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})
void createUser
```

ボディは JSON の `{"display_name":"…","email":"…"}` です。手書きのキーは逃げ道です。`body: { name: input.user.displayName }` は `name` を送ります。親オブジェクトが匿名なので、エイリアスは適用されません。

## 形が違うとき

path のプレースホルダ、リテラル、分岐には `builder` を使います。受け取るのは実値なので、`if`、`??`、テンプレート、`switch` が使えます。

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const search = defineRequest({
  method: 'GET',
  path: '/orgs/:org_id/users',
  input: struct.object({
    orgId: struct.number(),
    query: struct.object({
      keyword: struct.string(),
      pageSize: struct.number().alias('page_size'),
    }),
  }),
  builder: (input) => ({
    path: { org_id: input.orgId },
    query: input.query,
    headers: { 'x-api-version': '2' },
  }),
  output: struct.object({ items: struct.array(struct.string()) }),
})
void search
```

`query: input.query` は `page_size` を送ります。`headers: { 'x-api-version': '2' }` はリテラルです。認証とトレーシングは引き続きインターセプターに置きます。ビルダーのあと、ネイティブリクエストを見る場所です。

## 出力とエラーの形

`output` は 2xx ボディ用の struct 1 つ、`error` はそれ以外すべて用の struct 1 つです。`ok` だけが分岐点で、デコードするのは常に片側だけです。片側を省くとそのボディは読まれません。fault は status を運び、`data` は `undefined` のままです。

## 関連レシピ

- [宣言済み 404 付きの GET](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
