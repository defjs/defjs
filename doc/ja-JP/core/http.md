---
title: HTTP
description: リクエストを定義し、実行し、status で分岐し、signal または timeout でキャンセルします。
---

# HTTP

定義 → 実行 → タプルで分岐 → 画面が消えたらキャンセル。HTTP のループはこれだけです。

## Basic Setup

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [error, data, response] = await client.execute(getUser({ id: 7 }))
if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (!error) {
  console.log(data.name, response.status)
}
```

## URL を解決する

`withEndpoint(...)` には有効な絶対 URL が要ります。エンドポイントの pathname はディレクトリとして残り、query と hash はコマンド解決の前に捨てられます。

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({ path: { id: input.id }, query: { fields: input.fields } }),
})

const command = getUser({ id: 'a/b', fields: 'name' })
void client.execute(command)
// → https://api.example.com/v1/users/a%2Fb?fields=name
```

path のプレースホルダは生のスカラーで、ちょうど一度だけエンコードされます。空の値と `.` / `..` は拒否されます。1 つのプレースホルダの中のスラッシュ、`?`、`#`、`%`、空白、Unicode は、エンコードされた 1 セグメントのままです — 事前エンコードしないでください。

定義の path に `?` や `#` は入れられず、絶対やプロトコル相対にもできません。デフォルトの query エンコーダはスカラーとスカラーの配列を受け付けます（配列はキーを繰り返します）。入れ子オブジェクトは、クライアントに `withQuerySerializer(...)` が無ければ `REQ_BUILD_FAILED` で失敗します。`path`、`query`、`headers` の `null` も同じように失敗します。`undefined` は省略されます。

## 入力を配置する

struct が値をエンコードします。ビルダーがそれを配置します。`input` を宣言した定義では、入力がすでにリクエストの形でも、明示的な `builder` が必須です。`builder` を省略できるのは `input` がない定義だけです。

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  builder: (input) => ({
    path: input.path,
    headers: input.headers,
    body: input.body,
  }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})

const [error, user] = await client.execute(
  updateUser({
    path: { id: 7 },
    headers: { requestId: 'request-42' },
    body: { displayName: 'Ada' },
  }),
)
if (error) console.error(error.code)
else console.log(user.id)
```

そのボディは `application/json` の `{"display_name":"Ada"}` です。ヘッダーのワイヤ名は `x-request-id` です。呼び出し側とパース結果は `displayName` のままです。

ワイヤキーを自分で書くより、型付きの値を渡す方を選んでください。エイリアスはフィールドに一度宣言すれば両方向に効きます。`output` / `error` / イベント / 受信フレームは `display_name` を `displayName` にデコードし、`body: input.order` は木全体を書き換えます。同じ `User` struct を作成ボディにも取得の output にも使えます。手書きのキーは例外です。親オブジェクトが匿名なので、エイリアスは走りません。

| ビルダー式                                      | ワイヤ上                                                        |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `body: input.profile`                           | 型付きオブジェクト。エイリアスと `Date` / `bigint` のエンコード |
| `body: { profile: input.profile }`              | 外側のキーはリテラル。内側のオブジェクトは型付きのまま          |
| `body: { ...input.profile, role: 'admin' }`     | スプレッドは struct を保つ。追加キーはリテラル                  |
| `body: { name: input.profile.displayName }`     | 匿名の親。エイリアスは適用されない                              |
| `query: input.query` / `headers: input.headers` | 型付きのフラットなオブジェクト。エイリアスがワイヤキーになる    |

型付きオブジェクトをスプレッドしつつ、そのワイヤキーも置く（`displayName` の隣に `display_name`）と `REQ_BUILD_FAILED` です。`path` や `headers` の入れ子オブジェクトも同じように失敗します。

ガイドはルートだけでなく、各ノードで決まります。匿名の親の下に新しく書いたオブジェクトは、書いたキーのままです。型付きの親の下では、同じオブジェクトがそのフィールドの struct を使います。

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union のガイドが複数の分岐に一致したら、分岐ごとにエンコードして比較します。ワイヤ結果が同じならそれを採用し、違えば `REQ_BUILD_FAILED` です。

非 object 部分を含む混合 intersection は、解析時に一致した各部分のタグの連言をタグとして付け、解析せず新しく書いた値は匿名オブジェクトとして扱います。

### Query

入れ子の query 形（`a[b]`、`a.b`、カンマ区切り）はバックエンドの規約なので、フックはクライアントにあります。

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

ここでの `query` はエンコード済みのワイヤオブジェクトです。エイリアスはすでに適用されているので、`qs` のようなシリアライザがそれらを落としません。戻り値の文字列が query 文字列です。Defjs は `qs` に依存しません。

シリアライザが無ければ、配列はキーを繰り返し、入れ子オブジェクトは `REQ_BUILD_FAILED` です。ビルダーが `URLSearchParams` を返すと、その値がそのまま使われ、シリアライザは飛ばされます。query が無いときシリアライザは呼ばれません。そのあとインターセプターが見る `queryParams` は `new URLSearchParams(queryString)` です。

### Body

最初に一致したものが勝ちます。

| `body` の値                                                                | 送られるもの                                                         | デフォルトの content type                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| 省略 / `undefined`                                                         | ボディなし                                                           | —                                                      |
| ルートに `urlencoded` または `formData` コーデックがある型付きオブジェクト | `URLSearchParams` / `FormData`。キーはワイヤ名。配列はキーを繰り返す | フォームの型 / プラットフォームの boundary             |
| `FormData`、`URLSearchParams`                                              | そのまま                                                             | 同じ。Defjs は `FormData` の古い `Content-Type` を消す |
| `Blob` / `File`                                                            | そのまま                                                             | `blob.type`、または `application/octet-stream`         |
| `ArrayBuffer`、`TypedArray`、`DataView`                                    | そのまま                                                             | `application/octet-stream`                             |
| `ReadableStream`                                                           | ストリーム（ランタイムが許すとき `duplex: 'half'`）                  | `application/octet-stream`                             |
| `string`                                                                   | そのまま                                                             | `text/plain;charset=UTF-8`                             |
| object、array、number、boolean、`null`                                     | エンコードしてから `JSON.stringify`                                  | `application/json`                                     |

デフォルトを上書きするには、`headers` に `content-type` を置きます。コーデックのタグが効くのはボディのルートだけです。`body: { meta: input.form }` は JSON になり、フォームのフィールドは普通の JSON フィールドです。文字列は生テキストです。`"abc"` のような JSON 文字列には `JSON.stringify` と `application/json` が要ります。`undefined` のフィールドは省略されます。`nullable` なフィールドを `null` で送ると JSON の `null` になります。

`GET` と `HEAD` はボディを返せません — それは型エラーです。WebSocket のビルダーは `headers` も `body` も返せません。

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const login = defineRequest({
  method: 'POST',
  path: '/login',
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias('username'),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
})

const upload = defineRequest({
  method: 'POST',
  path: '/files/:id',
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData()
    input.photos.forEach((photo, index) => body.append('photo', photo, `photo-${index}.jpg`))
    return { path: { id: input.id }, body }
  },
})

void login
void upload
```

自分で走らせる `JSON.stringify`、`qs`、protobuf が見るのは論理名です。その経路ではエイリアスは適用されません。公開された `struct.encode` はありません。

ビルダーは実入力で分岐し、場合ごとに違うボディ（JSON のレコード、`File`、`URLSearchParams`）を返せます。ネイティブの `Headers` もそのまま渡され、再エンコードされません。

## ボディの読み方

`output` は 2xx ボディ用の struct 1 つ、`error` はそれ以外すべて用の struct 1 つです。表現を選ぶのは struct の kind です。`string` は生テキスト、`blob` / `file` は blob、`arrayBuffer` はバイト列、それ以外の kind は JSON です。どちらも宣言しなければ、ボディは読まれません。

処理の順序は次のとおりです。

1. `ok` が側を選びます。2xx は `output`、それ以外は `error`。両方読むことはありません。
2. その側に何も宣言が無い → ボディは読まれません。2xx は `data === undefined` で成功します。non-2xx は `data === undefined` の `HTTP_STATUS` です。宣言していない側の読めないボディは、読めなかったという事実も含めて無視されます。
3. メディアタイプはボディを読む**前**に確認されます。不一致は `RES_MEDIA_TYPE_INVALID` で、パースもデコードもされません。
4. 表現を読みます。失敗は `RES_DECODE_FAILED` です。トランスポートからの JSON は一度だけパースされます。その値の文字列は JSON の文字列ルートであり、もう一度パースされません。バイトと blob は生のままで、一度だけパースされます。
5. Struct が値をパースします。失敗は `RES_STRUCT_MISMATCH` です。
6. 2xx → 結果と型付きの `response.body`。non-2xx → `HTTP_STATUS` 上の型付き `data`。

デコードは一度だけ、インターセプターチェーンの後に起きます。だからインターセプターが `makeResponse(...)` で作ったレスポンスも、回線から来たものと同じように読まれます。JSON 表現では、文字列の body は JSON の文字列ルートです。

成功したレスポンスは `DecodedResponse<T>` です。`url`、`status`、`statusText`、`headers`、`ok`、型付きの `body` を持ちます。何もデコードされなかった場所では `HttpMeta` になります — 同じフィールドから `body` を除いたものです。`ok` は `200 <= status < 300` だけを意味します。どちらもネイティブの `Response` ではありません。トランスポート失敗は fault なので、その代わりを務める status 0 のレスポンスはありません。

## 作業をキャンセルする {#cancel-the-work}

実行 options は `signal` に加えて `abort` か `timeout` のどちらかを取ります。**`abort` と `timeout` は同時に使えません。** `signal` はどちらとも組み合わせられます。

```ts
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const command = defineRequest({ method: 'GET', path: '/report' })()
const controller = new AbortController()
const pending = client.execute(command, { signal: controller.signal, timeout: 5_000 })

controller.abort('screen closed')
const [error] = await pending
if (error?.code === 'NET_ABORTED') {
  console.log('caller cancellation')
}
```

`timeout` は `1..2_147_483_647` の正の安全な整数である必要があります。認識されたキャンセル → `NET_ABORTED`。実行タイムアウト → `NET_TIMEOUT`。インターセプターの `throw` → `EXT_INTERCEPTOR_FAILED`。その他の Fetch 失敗 → `NET_UNREACHABLE`。サーバーが書き込みを受け入れたあとのキャンセルは、書き込みがロールバックしたことの**証明にはなりません**。

## 資格情報と XSRF

`withCredentials(true)` は HTTP と SSE の Fetch に `credentials: 'include'` を設定します。`Authorization` は作らず、WebSocket 認証も設定しません。`false` は credentials を未指定のままにします。

`withXSRF(...)` は HTTP 専用です。デフォルトは `cookieName: 'XSRF-TOKEN'`、`headerName: 'X-XSRF-TOKEN'` です。ヘッダーを注入するのは非安全メソッドだけで、呼び出し側がすでに立てていないときだけで、同一オリジンのブラウザーリクエストだけです。`GET`、`HEAD`、`OPTIONS`、`TRACE` は飛ばします。ブラウザーの外で注入が要るなら、同期的でリクエストスコープの `tokenProvider` を渡してください。

資格情報、XSRF トークン、query 文字列は日常のログに出さないでください。query パラメータを一般的な資格情報の通り道にしないでください。

## 進捗と Fetch 境界

`onDownloadProgress` は、宣言されたレスポンスボディを読んでいるあいだ動きます。`lengthComputable` が true になるのは、正の `Content-Length` があるときだけです。その側に struct が無い → ボディは読まれない → ボディ読み取りの進捗もありません。

`onUploadProgress` は、Fetch が `ReadableStream<Uint8Array>` のリクエストボディを読むのを見ます。JSON やテキストのボディはそのストリームではありません — アップロード進捗が要るときは、ビルダーから `file.stream()`（または別の `ReadableStream`）を返してください。ランタイムがストリームボディを送れないとき、トランスポートは capability エラーを報告します。

`fetchHandler(httpRequest, fetchImpl?)` はより低レベルの Fetch 境界です。ネイティブの `Request` を組み立て、Fetch を呼び、表現を読み、`HttpResponse` を返します。コマンド入力の検証も、`output` の振り分けも、インターセプターも**しません**。注入したトランスポートのテストには便利ですが、`client.execute` の代わりにはなりません。

## リプレイの限界

Defjs は HTTP を**自動リトライしません**。読み取りのリトライにも、レビュー済みのタイムアウト/ネットワーク/重複方針が要ります。ミューテーションのリトライには、再生可能なバイト、サーバー側の支持、認証スコープとリクエストバイトに束縛された冪等キー、受信側の重複方針が要ります。

クライアント/コマンド/Fetch 境界には、失敗した書き込みがコミットしたかどうかは分かりません。リプレイの判断はアプリか、レビュー済みインターセプターに置いてください。インターセプターは低レベルリクエストをショートサーキットしたり差し替えたりできます。最終的な status とボディは、それでもコマンドの契約を満たす必要があります。

## 関連レシピ

- [宣言済み 404 付きの GET](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [HTTP 呼び出しをキャンセルする](../recipes/cancel-http.md)
- [ローカル Fetch ハンドルでテストする](../recipes/test-with-handle.md)
