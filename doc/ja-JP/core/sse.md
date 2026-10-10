---
title: Server-Sent Events
description: 型付き SSE ストリームを消費し、閉じ、終端の closed promise を await します。
---

# Server-Sent Events

ストリームを開き、反復し、所有しているハンドルを `await using` で解放します。手動の `close()` と `closed` も残っています。クライアントやプラグインは、返されたストリームを代わりに dispose しません。

## Basic Setup

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: {
    message: struct.object({ text: struct.string() }),
  },
})

const [error, stream] = await client.execute(notifications())
if (error) {
  console.error(error.code)
} else {
  await using ownedStream = stream
  for await (const event of ownedStream) {
    if (event.event === 'message') console.log(event.data.text)
  }
}
```

## ストリームを定義する

`defineEventStream(...)` には `events`、正の安全な整数の `maxBufferSize`、正の安全な整数の `maxQueueSize`、相対 `path` が要ります。method のデフォルトは `GET` です。

リクエストの形は HTTP と同じです。`builder` が `path`、`query`、`headers`、`body` を返します。`GET` / `HEAD` はボディを返せません。宣言した `error` struct は起動時の fault に型を付け、non-2xx のハンドシェイクボディを struct の kind でデコードします（`string` はテキスト、`blob` / `file` は blob、`arrayBuffer` はバイト列、それ以外は JSON）。`Accept` をすでに立てていなければ、Defjs は `Accept: text/event-stream` を送ります。 `input` を宣言した定義では、入力がすでにリクエストの形でも、明示的な `builder` が必須です。`builder` を省略できるのは `input` がない定義だけです。

論理ストリーム 1 つが、複数の物理 Fetch 試行にまたがれるのは、再接続を選んだ**とき**だけです。`withSSEReconnect` が無ければ、一時的なネットワーク失敗とストリーム読み取り失敗で論理ストリームは終わります。open が成功すれば、ハンドルは 1 つ、非同期イテレータも 1 つのままです。

## 開いて調べる

`client.execute(...)` は、status、content-type、ボディの検査が通ったあとでのみ解決します。

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: { message: struct.string() },
})

const [error, stream, startupOpen] = await client.execute(notifications())
if (error) {
  console.error(error.code, startupOpen?.response.status)
} else {
  console.log(stream.open.response.status, startupOpen.response.status, stream.open.url)
  stream.close('example-finished')
  await stream.closed
}
```

レスポンスは成功で、メディアタイプの essence が `text/event-stream` で、ボディがある必要があります。起動時の non-2xx → `HTTP_STATUS` です。`error` を宣言していれば、その fault はデコード済みのハンドシェイクボディを運びます。メディアタイプが悪いときは `RES_MEDIA_TYPE_INVALID`、宣言した kind として読めないボディは `RES_DECODE_FAILED` です。レスポンス到着後に検証が失敗しても、レスポンススナップショットがタプルの 3 番目に残ることがあります。

`startupOpen` は初期スナップショットです。`stream.open` はライブで、後の物理 open で変わります。最初のレスポンスが重要なときはタプル側の値を残してください。

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## イベントをデコードする

ワイヤのイベント名 → `events[eventName]`。なければ `events.default`。一致する Struct がなければイベントは届けられません。SSE の `event` フィールド欠落 → 論理名 `message`。

SSE の `data` はまずテキストです。`string` の struct はそのテキストをそのまま保ちます。それ以外の kind は JSON です。テキストをパースしてから struct でデコードします。`struct.object`、`struct.number`、`struct.boolean`、`struct.any`、`struct.unknown` は JSON であり、trim したテキストではありません。`ping` のような裸のトークンは `struct.literal('ping')` を満たしません。data は JSON である必要があります。JSON 文字列 `"abc"` を送るサーバーでも `struct.string()` は満たします。届く値はその生テキストで、引用符も含み、JSON デコードされて `abc` にはなりません。

発行される値は `event`、デコード済み `data`、任意の空でない `id` です。`default` があると、未知のイベント名は推論されたユニオンで `string` になります。

## 無効なイベントを観測する

無効/未宣言のイベントはキューに入らず落とされます。`withSSEOnInvalidEvent(...)` は生の ID、名前、テキストデータに加え、`missing-struct` または `validation-failed`、任意の cause を観測できます。

```ts
import { createClient, withEndpoint, withSSEOnInvalidEvent } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEOnInvalidEvent(({ reason, message, cause, signal }) => {
    if (signal.aborted) return
    console.info('Dropped SSE event', {
      reason,
      event: message.event,
      hasCause: cause !== undefined,
    })
  }),
)
```

オブザーバーは変換境界で動きます。アクティブな試行の signal が abort されていない限り、その失敗は隔離されます。短く保ち、生のイベントデータを信頼しないでください。

## 再接続

**振る舞いの変更:** SSE の再接続はオプトインです。`withSSEReconnect(...)` が無ければ、ネットワーク失敗とストリーム読み取り失敗は**リトライされません**（`attempts: 0` と同じです）。そうした失敗をリトライするには `withSSEReconnect({ attempts: 3 })`（または別のレビュー済み予算）を渡します。通常の EOF はリトライしません。status/content-type 検証、パーサ上限、メッセージ変換失敗、キューオーバーフロー、通常 EOF は論理ストリームにとって終端のままです。

```ts
import { createClient, withEndpoint, withSSEReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEReconnect({
    attempts: 3,
    delayMs: 1_000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.5,
    shouldReconnect({ attempt, open }) {
      return attempt <= 3 && (open?.response.status ?? 0) !== 401
    },
  }),
)
```

`attempts` は最初の試行のあとのリトライ回数を数えます。再接続オブジェクトを置いたときのデフォルトは `3` です。`attempts: 0` はリトライを無効にします。`withSSEReconnect` を省いてもリトライは無効です。`delayMs` は初期間隔です。`factor` で伸ばし、`maxDelayMs` がベースを上限します。SSE の `jitter` は WebSocket と同じ、**0–1 の乗法因子**です。ストリームの `retry:` フィールドは現在の間隔を更新します。方針コールバックが false / throw / reject を返すと、論理ストリームは終わります。

最後にパースしたイベント ID は、後の試行で `Last-Event-ID` になります。後の試行は、method と body を含めて同じ Fetch リクエストを送り直します。再接続の前に、サーバーの再生意味論を把握してください。

## バッファとキューの上限

どちらも正の安全な整数である必要があります。オーバーフローは致命的です — 古いイベントの黙った破棄はありません。

| 上限            | 守るもの                                         | 終端コード            |
| --------------- | ------------------------------------------------ | --------------------- |
| `maxBufferSize` | パース中の未完了/過大な SSE 行/イベント          | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | 1 人の消費者の読み取りより速く生産されるイベント | `CAP_QUEUE_OVERFLOW`  |

致命的なストリームはバッファ済みイベントも消し、アクティブなボディをキャンセルし、イテレータを reject し、`kind: 'error'` で `stream.closed` を解決します。

## 閉じて破棄する

`EventStreamHandle` は、ライブなオープニングスナップショット 1 つ、終端 promise 1 つ、`close` 1 つ、非同期イテレータ 1 つ、標準の非同期 disposer 1 つです。

```typescript twoslash
import type { EventStreamCloseInfo, EventStreamHandle, EventStreamOpenInfo } from '@defjs/core'

interface StreamApi<T> extends AsyncIterable<T>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}

const handle = null as unknown as EventStreamHandle<string>
const api: StreamApi<string> = handle
void api
```

終端コードは `eof`、`aborted`、または `error` です。`error` 結果は `EventStreamFaultCode` も持ちます。`CAP_BUFFER_EXCEEDED`、`CAP_QUEUE_OVERFLOW`、`EXT_HOOK_FAILED`、`EXT_OBSERVER_FAILED`、`NET_TIMEOUT`、`NET_UNREACHABLE`、`RES_DECODE_FAILED`、または `RES_MEDIA_TYPE_INVALID` です。

`close(reason)` はアクティブな試行を abort し、キューを閉じ、`aborted` として確定します。ループの `break` / `return` / throw はイテレータ return を呼び、`iterator-return` で閉じます。コマンドを実行したコードが閉鎖を所有します。

`await using` は同じ所有クローズ経路を呼び、Defjs の読み取り/再接続処理が止まり、アクティブな reader lock が解放されるまで待ちます。provider が制御する、決して settle しない `ReadableStream.cancel()` の promise については意図的に上限付きなので、その provider promise が完了したことは保証しません。理由や終端結果が要るときは、明示的な `stream.close(reason)` と `await stream.closed` も有効です。

構造的な独自 `EventStreamHandle` 実装は、今や `[Symbol.asyncDispose](): PromiseLike<void>` を提供し、同じライフサイクルへ繋ぐ必要があります。実装者にとってはコンパイル時の破壊的変更です。Defjs のハンドルを受け取るだけの利用者は、実行時に新しいものを呼ぶ必要はありません。

リポジトリで検証済みかつサポートされる最低 lib 契約は `ES2022`、`ESNext.Disposable`、`DOM`、`DOM.Iterable` で、リポジトリは TypeScript 7 に固定されています。この 4 つは 1 つの baseline として一緒に検証されています。各宣言が独立してすべての項目を強制する、という意味ではありません。未検証の古いコンパイラも約束しません。通常の HTTP クライアントは `AsyncDisposable` ではありません。各リクエストは timeout か `AbortSignal` で管理してください。

資格情報、イベントデータ、イベント ID、cause、ストリーム URL は日常ログに出さないでください。`withCredentials(true)` は SSE の Fetch cookie に効きますが、WebSocket 認証は設定しません。

## 関連レシピ

- [SSE ストリームを消費する](../recipes/consume-sse.md)
- [HTTP 呼び出しをキャンセルする](../recipes/cancel-http.md)
