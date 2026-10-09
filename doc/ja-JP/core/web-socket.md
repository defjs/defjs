---
title: WebSocket
description: 型付き JSON セッションを開始し、エンベロープを送受信し、close して closed を await します。
---

# WebSocket

開始 → 受信 → 送信 → `await using` で解放します。購読解除と破棄は呼び出し側の所有です。手動の `close()` / `closed` も残っています。クライアント、プロバイダ、インターセプターはセッションを自動 close しません。

## Basic Setup

```typescript twoslash
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
  outgoing: struct.object({ type: struct.literal('send'), text: struct.string() }),
})

const [error, session, startupConnection] = await client.execute(room())
if (error) {
  console.error(error.code, startupConnection?.generation)
} else {
  await using ownedSession = session
  const unsubscribe = ownedSession.onRuntimeError((cause) => console.error('runtime', cause))
  try {
    ownedSession.send({ type: 'send', text: 'Hello' })
    // wire: {"type":"send","text":"Hello"}
    for await (const message of ownedSession.receive) {
      console.log(message.type, message.text)
      break
    }
  } finally {
    unsubscribe()
  }
}
```

## 方向ごとに struct は 1 つ

`incoming` はすべてのテキストフレーム用の struct 1 つです。`outgoing` は `session.send(...)` 用の struct 1 つです。種類が複数なら `struct.discriminatedUnion` でモデルします。それらのフィールドのエイリアスが、両方向のワイヤ名です。別の型エンベロープも、ノーマライザもありません。

```json
{ "type": "message", "text": "Hello" }
```

受信したテキスト、`ArrayBuffer`、typed-array、`Blob` のフレームは UTF-8 として読まれ、JSON パースされ、`incoming` に対して検査されます。壊れた JSON と struct の失敗は `session.onRuntimeError` へ行き、キューには入りません。セッションは開いたままです。テキストでもバイト列でも `Blob` でもないフレームは無視されます。`withWebSocketOnInvalidEvent` はありません。

`session.send(...)` は同期的に検証してシリアライズします。struct のエンコード、それから `JSON.stringify` です。open ならすぐ送り、送信キューが有効な `reconnecting` 中はキューし、書けないときは `InvalidStateError` を throw します。outgoing struct が無いとき、ペイロードが struct に失敗したとき、送信キューが無効か満杯のとき、ネイティブ send が失敗したときも throw します。定義上の静的な `protocols` リストはエンドポイント契約です（たとえば `graphql-transport-ws`）。実行 options と `withWebSocketProtocols` はそれでも上書きできます。サブプロトコルに載せるトークンは、ビルダーではなく `beforeConnect` かインターセプターに置きます。ビルダーが返せるのは `path` と `query` だけです。

`receive` は消費者 1 人です。2 つ目のイテレータは拒否されます。

## 状態のスナップショット

| メンバー                   | 意味                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `state`                    | `idle`、`connecting`、`open`、`reconnecting`、`closing`、`closed`、`aborted`、`error` |
| `connection`               | 最新の物理接続。`generation`、URL、交渉した protocol、取れるときの extensions         |
| `bufferedAmount`           | ネイティブの未送信バイト数。物理ソケットが無ければ `0`                                |
| `receive`                  | 検証済み受信メッセージの、消費者 1 人の非同期イテラブル                               |
| `onStateChange(listener)`  | 論理状態の遷移を購読する。購読解除を返す                                              |
| `onRuntimeError(listener)` | 起動後のランタイムエラーを購読する。購読解除を返す                                    |
| `closed`                   | 論理的な終端クローズ結果の promise                                                    |

`open` は物理ソケットが開いた状態です。`reconnecting` は、置き換え前の準備と待ちを含みます。`connection.generation` は `open` に達した物理ソケットごとに増えます。タプルの `startupConnection` は最初の成功スナップショットのままです。`session.connection` は先へ進みます。

起動失敗 → `[error, undefined, connection?]` です。open 前のコンストラクタ失敗では connection が無いことがあります。起動中のタイムアウトや close では、スナップショットがまだ付くことがあります。セッションが返ったあとのランタイムエラーは、オブザーバー、`receive`、`closed` を通ります — 2 つ目の execute タプルにはなりません。

```typescript twoslash
import type { Fault, WebSocketConnectionInfo, WebSocketSession } from '@defjs/core'

type SocketResult<TIncoming, TOutgoing> =
  | [error: null, session: WebSocketSession<TIncoming, TOutgoing>, connection: WebSocketConnectionInfo]
  | [error: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const result: SocketResult<unknown, never> | undefined = undefined
void result
```

## 再接続

再接続はオプトインです。`reconnect` オブジェクトが無い → 物理 close で論理セッションは終わります。設定したときのデフォルトは `attempts: 3`、`delayMs: 1000`、`factor: 2`、`maxDelayMs: 30000`、`jitter: 0` です。`attempts` は最初の試行のあとのリトライ回数を数えます。`attempts: 0` は無効にします。デフォルトの述語は、あらゆる close 結果を受け入れます。

```ts
import { createClient, defineWebSocket, struct, withEndpoint, withWebSocketReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://chat.example.com'),
  withWebSocketReconnect({
    attempts: 3,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldReconnect({ attempt, code, wasClean }) {
      return attempt <= 3 && (wasClean !== true || code === 1006)
    },
  }),
)
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
})
const [error, session] = await client.execute(room())
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`shouldReconnect` は次のリトライ試行、close の cause、code、reason、`wasClean` を受け取ります。手動の `session.close(...)` は述語に入りません。準備や方針が throw すると、論理セッションはエラーで終わります。

WebSocket のバックオフ jitter は**乗法**です（`jitter: 0.2` → 遅延は `0.8x` から `1.2x`）。SSE の jitter は WebSocket と同じ、0–1 の乗法因子です。delay/factor/jitter/attempt の値はコンストラクタの前に検証されます。タイマー遅延は `2_147_483_647` ms を超えられません。

`beforeConnect({ attempt, signal })` は、最初のコンストラクタの前と、再接続のたびに走ります。キャンセルが準備と接続の両方を止めるよう、その signal をトークン更新に渡してください。

## ハートビート

実行時かクライアントスコープでオプトインします。間隔ごとに `message()` を outgoing struct 経由で送ります。任意の `isAck(message)` が ack を認識します — そのメッセージはタイムアウトを消し、`receive` には**届けられません**。

```ts
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.discriminatedUnion('type', [struct.object({ type: struct.literal('pong'), ok: struct.boolean() })]),
  outgoing: struct.object({ type: struct.literal('ping') }),
})

const [error, session] = await client.execute(room(), {
  heartbeat: {
    intervalMs: 30_000,
    timeoutMs: 10_000,
    message: () => ({ type: 'ping' }),
    isAck: (message) => message.type === 'pong',
  },
})
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`intervalMs` と `timeoutMs` は、`2_147_483_647` 以下の正の有限タイマーである必要があります。ハートビートのメッセージは outgoing struct に対して妥当である必要があります。シリアライズ、ネイティブ send、ack の分類、タイムアウトの失敗は論理セッションにとって致命的です — 普通の再接続にはなりません。

## キュー

| 設定                   | 必要な値                               | 振る舞い                                                                                                  |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `maxIncomingQueueSize` | 正の安全な整数                         | `receive` を待つパース済みメッセージと、変換を待つ生フレームを上限する。オーバーフロー → `state: 'error'` |
| `maxOutgoingQueueSize` | 任意の非負の安全な整数。デフォルト `0` | `state === 'reconnecting'` のあいだだけ FIFO。満杯か無効 → `send(...)` が throw                           |

キューされた送信フレームは、置き換えソケットが `open` を公開する前に流されます。前のソケットですでに送ったフレームが自動再生されることはありません。再接続キューは、再接続中に送るメッセージ用です — アプリ状態の再構成用ではありません。

受信オーバーフローは保留シーケンスを消し、`receive` を失敗させ、セッションを止め、`kind: 'error'` で `session.closed` を解決します。消費者を十分速くするか、測ったサイズ/メモリから上限を上げてください。

## プロトコルと認証

定義の `protocols`、クライアントの `withWebSocketProtocols(...)`、execute の `protocols` が、コンストラクタのサブプロトコルリストを決めます。優先順位は、実行 → クライアント → 定義です。最初に決まったリストは論理セッション用にコピーされ、再接続でも再利用されます。

ブラウザーの WebSocket コンストラクタは任意のハンドシェイクヘッダーを受け付けず、ビルダーも `headers` や `body` を返せません。Defjs は `http:` を `ws:` に、`https:` を `wss:` に変換し、path プレースホルダを一度だけエンコードし、query 規則は HTTP と同じです。デフォルトはスカラーと繰り返すキー、入れ子オブジェクトには `withQuerySerializer`、query が無いときはシリアライザを呼びません。

`withCredentials(true)` は HTTP/SSE の Fetch credentials であり、WebSocket 認証ではありません。レビュー済みの cookie/セッション方針、サブプロトコル、短命の接続チケットを使ってください。一般的な資格情報や長命の秘密を query 文字列に置かないでください。

## 閉鎖と所有権

`session.close(code?, reason?)` は終端クローズを要求し、ハートビートを止めます。code は `1000` か `3000..4999`、reason は UTF-8 で 123 バイト以下です。不正な close 引数は、状態を変える前に throw します。手動の close 理由や論理的な終端結果が要るときは、`await session.closed` と一緒に使ってください。

```typescript twoslash
import type { WebSocketSession } from '@defjs/core'

async function observeSession(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  console.log(ownedSession.state)
}

void observeSession
```

`session.closed` は論理的な終端スナップショットです。`'closed'`、`'aborted'`、`'error'` と、任意のネイティブ `code` / `reason` / `wasClean`、aborted/error の `cause` です。観測したネイティブ close のフィールドは、所有者が要求したフォールバックより優先されます。

標準の非同期 disposer はベストエフォートでネイティブ close を要求し、それから Defjs が所有するライフサイクル、メッセージポンプ、タイマー、リスナー、キュー、ソケット参照の teardown を待ちます。close イベントが 1 秒以内に観測されなければ teardown は強制され、disposer は `TimeoutError` という名前の `DOMException` で reject することがあります。これは物理 TCP 接続が閉じたことの証明ではありません。disposer を繰り返して呼んでも、同じ teardown を共有します。構造的な独自セッション実装は、今や同じ `[Symbol.asyncDispose](): PromiseLike<void>` 契約を提供する必要があります。

## GraphQL の境界

Defjs が渡すのは、incoming struct 1 つ、outgoing struct 1 つ、論理セッションのライフサイクルです。WebSocket のアプリケーションプロトコルは**実装しません**。GraphQL-over-WebSocket の機能 — connection init、operation ID、`next`/`error`/`complete`、破棄、サブスクリプションの再生 — はコア契約の外です。

サーバーがそのプロトコルを要求するときは `graphql-ws` のようなプロトコルクライアントを使うか、フレームを `defineWebSocket(...)` でモデルしてください。`graphql-transport-ws` のような静的サブプロトコルは `protocols` に置きます。struct だけでは GraphQL の意味論は交渉されません。

## 関連レシピ

- [WebSocket セッションを開く](../recipes/websocket-session.md)
- [SSE ストリームを消費する](../recipes/consume-sse.md)
