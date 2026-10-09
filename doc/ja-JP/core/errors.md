---
title: Errors
description: 404、タイムアウト、読めないボディ、トランスポート失敗を、閉じた fault コード集合で分岐します。
---

# Errors

404、タイムアウト、読めないボディは、throw を catch するのではなく error-first タプルを読んで扱います。`Fault` はネイティブの `Error` で（`instanceof Error` は真）、判別に使う field はひとつだけ、`code` です。

`kind` はありません。失敗の類別は code の最初の `_` より前の部分そのものなので、`NET_TIMEOUT` は `NET` の失敗、`RES_STRUCT_MISMATCH` は `RES` の失敗です。粗く振り分けるならプレフィックスを、正確に判断するなら code 全体を読んでください。

## 基本の使い方

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

const [err, user, response] = await client.execute(getUser({ id: 7 }))
if (err?.code === 'HTTP_STATUS' && err.status === 404) {
  console.log(err.data.message)
} else if (err?.code === 'NET_TIMEOUT') {
  console.log('timed out')
} else if (err?.code === 'RES_STRUCT_MISMATCH') {
  console.log('the response did not match what we declared', err.response.status)
} else if (!err) {
  console.log(user.name, response.status)
}
```

集合が閉じているので、`code` に対する `switch` は網羅的になります。

```typescript twoslash
import { createNetworkFault, ERR_ABORTED, type Fault } from '@defjs/core'

function triage(fault: Fault): string {
  switch (fault.code) {
    case 'HTTP_STATUS':
      return `status ${fault.status}`
    case 'RES_MEDIA_TYPE_INVALID':
    case 'RES_DECODE_FAILED':
    case 'RES_STRUCT_MISMATCH':
      return 'the contract did not hold'
    case 'NET_TIMEOUT':
    case 'NET_ABORTED':
    case 'NET_UNREACHABLE':
    case 'NET_BODY_INCOMPLETE':
      return 'retryable'
    case 'REQ_INPUT_INVALID':
    case 'REQ_OPTIONS_INVALID':
    case 'REQ_BUILD_FAILED':
      return 'fix the call'
    case 'EXT_INTERCEPTOR_FAILED':
    case 'EXT_HOOK_FAILED':
    case 'EXT_OBSERVER_FAILED':
      return 'fix the code you attached'
    case 'CAP_BUFFER_EXCEEDED':
    case 'CAP_QUEUE_OVERFLOW':
      return 'raise a declared limit or read faster'
    case 'ENV_UNSUPPORTED':
      return 'the host runtime is missing something'
  }
}

const example: Fault = createNetworkFault(ERR_ABORTED)
console.log(triage(example))
```

## 安定した code

| 類別   | Code                                                                   | 直すべきは誰か                                  |
| ------ | ---------------------------------------------------------------------- | ----------------------------------------------- |
| `HTTP` | `HTTP_STATUS`                                                          | 相手が 2xx 以外を返した。業務ロジックとして扱う |
| `REQ`  | `REQ_INPUT_INVALID`、`REQ_OPTIONS_INVALID`、`REQ_BUILD_FAILED`         | 呼び出し側、またはエンドポイント宣言            |
| `NET`  | `NET_ABORTED`、`NET_TIMEOUT`、`NET_UNREACHABLE`、`NET_BODY_INCOMPLETE` | 誰でもない、あるいはリトライ                    |
| `RES`  | `RES_MEDIA_TYPE_INVALID`、`RES_DECODE_FAILED`、`RES_STRUCT_MISMATCH`   | 宣言と相手のすり合わせ                          |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`、`EXT_HOOK_FAILED`、`EXT_OBSERVER_FAILED`     | あなたがパイプラインに付けたコード              |
| `CAP`  | `CAP_BUFFER_EXCEEDED`、`CAP_QUEUE_OVERFLOW`                            | 宣言した上限、または消費側のペース              |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | ホストのランタイム                              |

集合を閉じているのは意図的です。それが `switch` の網羅性を保ちます。拡張は自分の詳細を新しい code ではなく `cause` で報告します。

### 形ごとの field

| Code           | `status` | `response`                                                       | `data`                                            |
| -------------- | -------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `HTTP_STATUS`  | 常にある | 常にある。`error` を宣言してデコードできたときだけ `body` を持つ | デコード済みの `error` ボディ、または `undefined` |
| `RES_*`        | 常にある | 常にあるがメタデータだけ — **`body` なし**                       | なし                                              |
| それ以外すべて | なし     | トランスポートが既にメタデータを持っていた場合のみ               | なし                                              |

`cause` は下位の値を運びます。struct 不一致なら `StructError`、表現が読めないならパーサーの失敗、拡張が投げたものならそれそのままです。

## トランスポート別のタプルの形

```typescript twoslash
import type {
  DecodedResponse,
  EventStreamHandle,
  EventStreamOpenInfo,
  Fault,
  HttpMeta,
  WebSocketConnectionInfo,
  WebSocketSession,
} from '@defjs/core'

type HttpResult =
  | [err: null, data: unknown, response: DecodedResponse<unknown> | HttpMeta]
  | [err: Fault, data: undefined, response: undefined]
type SseResult =
  | [err: null, stream: EventStreamHandle<unknown>, open: EventStreamOpenInfo]
  | [err: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]
type SocketResult =
  | [err: null, session: WebSocketSession<unknown>, connection: WebSocketConnectionInfo]
  | [err: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const results: [HttpResult, SseResult, SocketResult] | undefined = undefined
void results
```

HTTP の失敗では第三要素が `undefined` です。存在したレスポンスのメタデータは、すでに fault が抱えています。これが大事なのは、ハンドラーに渡すもの、ログに出すもの、再 throw するものが fault そのものだからです。メタデータは fault の _隣_ ではなく、fault と _一緒に_ 運ばれる必要があります。

SSE と WebSocket では第三要素は起動時のスナップショットで、起動が失敗したときにも存在しえます。ハンドルやセッションが返ったあとの失敗は、そのライフサイクル上で扱われます。確定した起動タプルを書き換えることは決してありません。

## ボディの読み方

`ok` だけが分岐点で、デコードするのは常に片側だけです。`output` は 2xx ボディを読み、`error` はそれ以外すべてを読みます。片方を省けば、そのボディは読まれません。

| 状況                                            | 結果                                                       |
| ----------------------------------------------- | ---------------------------------------------------------- |
| 2xx、`output` を宣言、ボディがデコードできた    | 成功。`data` と `response.body` に型が付く                 |
| 2xx、`output` を省略                            | 成功。`data` は `undefined` で、レスポンスに `body` はない |
| non-2xx、`error` を宣言、ボディがデコードできた | 型付き `data` を伴う `HTTP_STATUS`                         |
| non-2xx、`error` を省略                         | `data: undefined` の `HTTP_STATUS`                         |
| メディアタイプが表現の要求と違う                | `RES_MEDIA_TYPE_INVALID`。ボディを読む**前**に報告         |
| バイト列がその表現ではない                      | `RES_DECODE_FAILED`                                        |
| 値がその struct ではない                        | `RES_STRUCT_MISMATCH`                                      |
| **宣言していない**側のボディが読めない          | 完全に無視 — 下記参照                                      |

覚えておく価値があるのは最後の行です。`output` を宣言して `error` を宣言していない場合、ボディが壊れた JSON の 500 は `HTTP_STATUS` と `status: 500` として報告されます。あなたはエラーボディに関心がないと言ったのであり、それは「読めなかったことにも関心がない」を含みます。

デコードは一度だけ、インターセプターチェーンの後に起きます。インターセプターが `makeResponse(...)` で作ったレスポンスも、回線から来たものと同じメディアタイプ確認と同じ struct を通ります。

`HttpResponse.ok` は `200 <= status < 300` だけを意味します。トランスポート失敗は fault であってレスポンスではありません。その代わりを務める status 0 のレスポンスは存在しません。

## エラーボディの union を絞り込む

ひとつの `error` struct が 2xx 以外のすべての status を受け持つので、形が異なるときは union を宣言します。そのあと `fault.data` に対して何ができるかは、その union をどう宣言したかで完全に決まります。ライブラリはあなたが要求した型をそのまま返します。

`struct.or(...)` は素の union を作り、TypeScript はそれを自力で絞り込めません。必要な field を検査してください。

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` は、ボディが実際に持っている field で絞り込みます。API が既にエラーにタグを付けているなら、これが一番楽な形です。

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('validation'), fields: struct.array(struct.string()) }),
  struct.object({ kind: struct.literal('rateLimit'), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS') {
  switch (fault.data.kind) {
    case 'validation':
      console.log(fault.data.fields.length)
      break
    case 'rateLimit':
      console.log(fault.data.retryAfter)
      break
  }
}
```

API が status を**ボディの中に**入れている場合は、`fault.status` ではなくそれで判別してください。

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('status', [
  struct.object({ status: struct.literal(404), resource: struct.string() }),
  struct.object({ status: struct.literal(429), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && fault.data.status === 429) {
  console.log(fault.data.retryAfter)
}
```

API が対応しているなら、最後の形を選ぶ価値があります。`fault.status` は HTTP 層の数値で、プロキシ・ゲートウェイ・CDN が書き換えられます。一方 `data.status` は、あなたの `error` struct が断言したボディからデコードされた値なので、そこに到達できること自体がバックエンドがそれを出した証拠になります。

判別 field を持たないために絞り込めない union は、宣言側の性質であってライブラリの性質ではありません。ライブラリはあなたが宣言した型を渡します。絞り込みたいなら struct に判別 field を足してください。

## 起動時と開いたあと

SSE はハンドルを resolve する前に、status、`text/event-stream`、ボディの有無を検証します。non-2xx → `HTTP_STATUS`。メディアタイプ違い → `RES_MEDIA_TYPE_INVALID`。ボディなし → `RES_DECODE_FAILED`。開始時のスナップショットはそれでもタプル第三要素に入りえます。

WebSocket の起動時はハンドシェイクと最初の物理 open を含みます。コンストラクターの失敗、open 前のクローズ、タイムアウト、キャンセルは、どれも起動タプルを生みます。ソケットが `open` に達しなかった場合でも接続スナップショットは存在しえます。

| トランスポート | 起動後                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSE            | 致命的エラーでイテレーターが reject。`stream.closed` は `kind: 'error'` と fault の `code` で resolve                                                 |
| WebSocket      | メッセージ／キュー／ハートビートの失敗は `onRuntimeError`。終端エラーで `receive` が失敗。`session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP           | execute の promise は一度だけ settle。インターセプターやコールバックのコードは、タプル正規化の外でなお throw しえます                                 |

`NET_ABORTED` / `NET_TIMEOUT` は、呼び出し側が起動時に何を見たかを表します。返ってきた stream や session は、やはり閉じて終端 promise を await してください。

## ネイティブ Error のログと cause

Fault はネイティブの `Error` インスタンスなので、診断アダプターは不要です。`String(fault)` は安定したネイティブ形式 `DefjsFault: <message>` を返します。`code` と各バリアントの field — `status`、`response`、`data` — は構造化ログのために列挙可能なままで、`name` とネイティブの `cause` チェーンは列挙不可です。

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

`format()`、`flatten()`、`prettify()` を呼ぶ前に、`fault.cause instanceof StructError` で絞り込んでください。これらの helper は Struct 側の cause に付いていて、fault にコピーされません。制御フローに `message` や `String(fault)` を解析させないでください。契約は `code` と、レビュー済みの `status` です。

## リファレンス

| 分岐                         | 制御フローの判定                   | 使える安定 field                             | 通常はない／機微                    |
| ---------------------------- | ---------------------------------- | -------------------------------------------- | ----------------------------------- |
| HTTP status の方針           | `fault.code === 'HTTP_STATUS'`     | `fault.status`、レビュー済み `fault.data`    | ボディ、headers、URL、`cause`       |
| 呼び出し側のキャンセル       | `fault.code === 'NET_ABORTED'`     | `code`                                       | キャンセル理由とスタック            |
| タイムアウト                 | `fault.code === 'NET_TIMEOUT'`     | `code`                                       | リクエスト URL と下位の cause       |
| 契約が破れた                 | `fault.code.startsWith('RES_')`    | `code`、レビュー済み `fault.response.status` | Struct issue、ボディ、入力値        |
| 自分のコードが投げた         | `fault.code.startsWith('EXT_')`    | `code`、`cause`                              | 拡張が付けたものすべて              |
| ストリーム／セッション実行時 | `stream.closed` / `session.closed` | 終端の `kind` と `code`                      | イベントペイロード、フレーム、cause |

`cause`、`data`、レスポンスの headers とボディ、URL、Struct issue、入力値、スタックは機微情報として扱ってください。控えめな要約はこうです。

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`、`createPreflightFault`、`createDecodeFault`、`createHttpStatusFault`、`createUndecodedHttpStatusFault` がこれらのネイティブ Error 値を作ります。通常のリクエスト失敗はこれまで通りタプルで返され、ネイティブ Error の振る舞いを継承しているだけで throw されることはありません。`ERR_ABORTED` と `ERR_TIMEOUT` は、トランスポートの正規化器が認識する共有の cause です。

## 関連レシピ

- [宣言された 404 付きの GET](../recipes/get-declared-404.md)
- [HTTP 呼び出しをキャンセルする](../recipes/cancel-http.md)
