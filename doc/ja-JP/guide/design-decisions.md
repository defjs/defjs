---
title: 設計上の判断
description: Defjs が契約・コマンド・トランスポート結果・デコード・所有権を明示的に保つ理由です。
---

# 設計上の判断

Defjs はいくつかの意図的なトレードオフを取っています。便利 API は、誰がリクエスト・ストリーム・セッションを所有しているかを隠しがちです。Defjs はその境界を見えるままにして、同じエンドポイント契約を再利用しても、キャッシュやリトライスケジューラやリソースマネージャを黙って抱え込まないようにしています。

## 宣言は断言である {#declaration-is-an-assertion}

この六条が、レスポンスの読み方に関するあらゆる問いを決めます。後の議論で導出を繰り返さずに参照できるよう、番号を振ってあります。

### 1. 宣言したものが、あなたの断言

`output` は「`ok` が true のとき、ボディは**この形である**」という意味です。`error` は「`ok` が false のとき、ボディは**この形である**」。宣言はヒントでも、うまくいけばという願望でもなく、何が届くかについての主張です。

### 2. `ok` だけが分岐点で、読むのは常に片側だけ

2xx は `output` で読みます。それ以外はすべて `error` で読みます。両方試すことはなく、もう一方をフォールバックにすることもありません。

### 3. 断言と違う現実は失敗であり、はっきり報告する

フォーマットの推測なし、弱いものへの格下げなし、沈黙なし。バックエンドが変わったのか、ゲートウェイが介入したのか、誰かがレスポンスを改竄したのか——**結論は変わりません**。ライブラリには見分けられませんし、見分けられるふりをするべきでもありません。

これは最も「緩めてほしい」と言われる条なので、はっきり述べておきます。あなたのページが `output` で読もうとしていた `200` を攻撃者が書き換えられるとして、代わりに `3xx`、`4xx`、`5xx` が届いたとします。失敗するのは不便ではなく、唯一安全な帰結です。「念のため」に生のボディを渡すことは、レスポンスを注入できる者に、あなたが要求した検証を回避する道を与えることになります。

### 4. デコードに失敗したなら、ボディは存在しない

ボディ**とは**デコード済みの値です。デコードに失敗したなら値はありません——検査できる半端なボディなど存在しません。問題の詳細は `cause` に載り、レスポンスはメタデータだけを保ちます。

この条は規約ではなく型システムが強制します。デコード fault の `response` は `HttpMeta` で、`body` フィールドがそもそも無いので、触ろうとするとコンパイルエラーになります。

### 5. 断言に縛られたくないなら、宣言しない

`output` を省くのは「2xx のボディには関心がない」という意味で、それは読まれません。`error` を省けば、それ以外についても同じです。これは見落としではなく明示的な opt-out で、しかも徹底しています。opt out した側のボディが読めなかったとして、それはあなたの関心事ではありません。「読めなかった」という事実すら含めて。

### 6. 3xx はエラーコードの範囲ではない

あるエンドポイントがリダイレクト status を返すと知っているなら、`output` にそのスキーマを渡さないか、空の値を受け付けるスキーマを宣言してください。そうでなければ失敗が報告されるのは想定どおりで、抜けではありません。

## 明示的なクライアント

`createClient(...)` はエンドポイント設定を明示的な値にします。環境やリクエストスコープが違えば、エンドポイント・資格情報・インターセプター・シリアライザ・トランスポートハンドルも違います。

代償は、プロセス全体のデフォルトがないことです。その代償はサーバーで効きます — options やクロージャが認証・cookie・ユーザー・テナント・リクエストメタデータを掴むなら、クライアントをリクエスト境界の中で作ります。明示的なクライアントでも、インターセプターが掴んだ状態は隔離されません。クライアントの同一性そのものがセキュリティ境界ではありません。

クライアントはコマンドをディスパッチします。進行中の作業は所有しません。HTTP リクエスト・SSE ストリーム・WebSocket セッションを始めた側が、キャンセルまたは close し、終端の promise を await する必要があります。

## 定義、エンドポイント、コマンド

定義は安定した契約です。method、path、入力 struct、`ok` の両側をデコードする struct、トランスポートの上限。`defineRequest` はエンドポイントを返します。それを呼ぶと、1 回の実行用の不透明なコマンドが 1 つできます。

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const command = getUser({ id: 7 })
```

バックグラウンドジョブと UI の所有者は、同じ `getUser` の形を、違うキャンセル/リトライ方針で実行できます。コマンドを不透明にしておくと、アプリコードが内部のトランスポートタグや symbol に依存しなくなります。

## トランスポート固有の結果

3 つのトランスポートともエラーファーストのタプルを使います。汎用の単一「レスポンス」だと、ライフサイクルの事実が消えてしまいます。

- HTTP → `[err, data, response]` — デコード済み出力 + それを生んだレスポンス
- SSE → `[err, stream, open]` — 1 つの論理ストリーム + 起動時のレスポンススナップショット
- WebSocket → `[err, session, connection]` — 論理セッション + 起動時の接続スナップショット

成功時、3 番目の値は常にあります。HTTP の失敗は `[error, undefined, undefined]` です。fault がすでにレスポンスのメタデータを抱えており、ハンドラーに渡すもの、ログに出すもの、再 throw するものは、その fault です。SSE と WebSocket の起動失敗では、スナップショットを捕捉できていれば、open または connection がまだ含まれることがあります。

SSE と WebSocket では、3 番目の値はスナップショットであり、将来の再接続が同じ物理接続を保つという promise ではありません。起動後のライフサイクル制御は、返されたハンドルまたはセッションに属します。

## 実行時デコード

TypeScript の推論は期待するものを記述しますが、サーバーレスポンスを実行時に検査はできません。Struct のパースが契約のもう半分です。Defjs はリクエスト組み立ての前にコマンド入力を検証し、表現を確かめ、`ok` のどちら側が当てはまるかに応じて struct をパースします。

デコードは**一度だけ、インターセプターチェーンの後で**起きます。インターセプターが `makeResponse(...)` で作ったレスポンスは、回線から来たものとまったく同じに解釈されます。レスポンスがどこから来たかは読み方を変えないので、「インターセプターを信頼する」という考えるべき経路は存在しません。

順序は、メディアタイプ、次に表現、次に struct です。

| 守られなかったもの                       | Fault                                               |
| ---------------------------------------- | --------------------------------------------------- |
| メディアタイプが宣言した表現の要求と違う | `RES_MEDIA_TYPE_INVALID` — ボディを読む**前**に報告 |
| バイト列がその表現ではない               | `RES_DECODE_FAILED`                                 |
| 値がその struct に合わない               | `RES_STRUCT_MISMATCH`                               |
| non-2xx で `error` がデコードできた      | 型付き `data` を伴う `HTTP_STATUS`                  |
| non-2xx で `error` を宣言していない      | `data: undefined` の `HTTP_STATUS`                  |

メディアタイプを先に確かめることが、「JSON を要求して HTML が届いた」をパーサーエラーではなく一つの正確な fault に変えます。しかも読み取り・パース・struct をまとめて省きます。

## ビルダー、エンコーダ、エイリアス

struct は両方向のフィールド契約です。`.alias(name)` がワイヤ名です。struct が値のエンコード方法を決め、`builder` がその値の行き先を決めます。

`builder` は同期的な純粋関数です。受け取るのはパース済みの入力 — 束縛ビューではなく実値 — で、返すのはリクエストの `path`、`query`、`headers`、`body` です。コマンドの実行時に走ります。throw するとタプル上の `REQ_BUILD_FAILED` になります。エンドポイントを呼ぶこと自体は throw しません。 `input` を宣言した定義では、入力がすでにリクエストの形でも、明示的な `builder` が必須です。`builder` を省略できるのは `input` がない定義だけです。

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createBatch = defineRequest({
  method: 'POST',
  path: '/accounts/:account_id/users',
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    users: struct.array(
      struct.object({
        displayName: struct.string().alias('display_name'),
        email: struct.string(),
      }),
    ),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { 'x-api-version': '2' },
    body: { users: input.users },
  }),
  output: struct.object({ accepted: struct.number() }),
})

const command = createBatch({
  accountId: 42,
  users: [{ displayName: 'Ada', email: 'ada@example.com' }],
})
void command
```

既定の道は、型付きの値をそのまま渡すことです。`body: { users: input.users }` は各ユーザーのエイリアスを保つので、ワイヤのフィールドは `display_name` です。自分で書いたキー（`account_id`、`x-api-version`）はリテラルです。型付きオブジェクトをスプレッドするとその struct が保たれます。論理フィールドの横にワイヤキーを足すと `REQ_BUILD_FAILED` です。

query の入れ子はバックエンドの性質なので、クライアント側に置きます。`withQuerySerializer((query) => string)` はエンコード済みのワイヤオブジェクトを見ます。エイリアスも含まれます。query が無いときは呼ばれません。ビルダーが返した `URLSearchParams` はこれを飛ばします。シリアライザが無ければ、配列はキーを繰り返し、入れ子オブジェクトは失敗します。インターセプターが見る `queryParams` は `new URLSearchParams(queryString)` です。

ボディの種類は値から決まり、最初に一致したものが勝ちます。

- `body` が無い → 何も送らない
- ボディのルートに `urlencoded` または `formData` のコーデックがある → そのフォームエンコード。値が JSON の中にネストしているときは、このタグは適用されません
- `FormData`、`URLSearchParams`、`Blob`、`File`、バイト列、`ReadableStream` → そのまま送る
- 文字列 → `text/plain;charset=UTF-8`
- それ以外 → JSON

`undefined` のフィールドは省略されます。nullable なフィールドの `null` は送られます。文字列は、自分で文字列化して `content-type` を立てない限り JSON ではありません。自分でシリアライズする（`JSON.stringify`、qs、protobuf）と struct エンコーダから外れるので、エイリアスは適用されません。公開された `struct.encode` はありません。

`GET` と `HEAD` はボディを運べません。WebSocket のビルダーは headers も body も返せません。静的な WebSocket サブプロトコルはビルダーではなく定義の `protocols` に置きます。不正な WebSocket フレームはセッションのランタイムエラーリスナーへ行きます。SSE の `error` struct は起動時の fault に型を付け、ハンドシェイクのボディは HTTP ボディと同じ kind 規則に従います。`string` はテキスト、blob と file は blob、`arrayBuffer` はバイト列、それ以外は JSON です。

## オブザーバーと方針の置き場所

インターセプターはトランスポート全体の方針向けです。認証、トレーシング、ショートサーキット、レビュー済みリトライ。自分のトランスポートだけ動き、オニオン順で合成されます。実行 options は作業固有の寿命向けです。`signal`、`timeout`、WebSocket ハートビート、オプトイン再接続。

オブザーバーは、起きたことを報告するだけで、第二の所有者にはなりません。SSE の `onInvalidEvent`、WebSocket の状態リスナー、ランタイムエラーリスナーは、境界付きの診断とメトリクス向けです。返されたストリーム/セッションが、反復・close・購読解除・終端待ちを所有したままです。キャッシュ、古い結果の抑制、冪等性、ドメインエラーの写像は、`client.execute(...)` の周りに置き、アプリ自身の方針と状態が見える場所にしてください。

## OpenAPI、ソースマップ、テレメトリ

Defjs は第二の OpenAPI 契約を生成したり同期したりしません。OpenAPI がすでに権威なら、それを保ち、アプリ境界で実行時検証を足します。新しいサービスなら、エンドポイント定義と Struct を直接のワイヤ契約にしてよいです — 第二の単一情報源は不要です。

`withOpenTelemetryServer(...)` はクライアントに **アウトバウンド** の Defjs 計測を足します。OpenTelemetry SDK の初期化はしません。`tracer` は必須、`meter` は任意、3 トランスポートはデフォルト有効、WebSocket の query 伝播はデフォルト無効です。operation 名は静的で低カーディナリティに保ってください。伝播・フック・URL・ヘッダー・ペイロード・cause・保持期間は、機微になり得るものとして見直してください。

ソースマップはデプロイの判断であり、Defjs の振る舞いではありません。`sourcesContent` 付きの公開マップはソースを晒します。隠したマップでもソースとパスは入ります。マップを無効にするとソースレベルでのシンボル化は失われます。非公開マップは、明示的なアクセスと保持ルール付きの、デプロイ可能なデバッグ成果物として扱ってください。

## 関連レシピ

- [宣言済み 404 付きの GET](../recipes/get-declared-404.md)
- [ローカル Fetch ハンドルでテストする](../recipes/test-with-handle.md)
