---
title: Interceptors
description: HTTP・SSE・WebSocket の方針を、トランスポート境界でオニオン順に重ねます。
---

# Interceptors

認証ヘッダーの追加、メンテナンス窓のショートサーキット、安全な読み取りのリトライ — コマンド検証には触れずに。トランスポートごとに鎖があります。入ってくるのは `HttpRequest`。返すのはそのトランスポートの結果（`HttpResponse`、イベントストリームハンドル、または WebSocket セッション）です。入力検証は鎖の前、status 振り分けとデコード済み結果は後です。

## Basic Setup

```typescript twoslash
import { createClient, createHttpInterceptor, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit))
void client
```

## オニオン順

`withInterceptors(...items)` は混在インターセプターを受け付けます。クライアントは選ばれたトランスポートの `kind` でフィルタし、登録の相対順を保ちます。各インターセプターは `next` の前後で動けます。

| ファクトリ                   | リクエスト    | `next` からの結果                     |
| ---------------------------- | ------------- | ------------------------------------- |
| `createHttpInterceptor`      | `HttpRequest` | `Promise<HttpResponse<unknown>>`      |
| `createSSEInterceptor`       | `HttpRequest` | `Promise<EventStreamHandle<unknown>>` |
| `createWebSocketInterceptor` | `HttpRequest` | `Promise<WebSocketSessionLike>`       |

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

const order: string[] = []
const first = createHttpInterceptor(async (request, next) => {
  order.push('first:before')
  const response = await next(request)
  order.push('first:after')
  return response
})

const second = createHttpInterceptor(async (request, next) => {
  order.push('second:before')
  const response = await next(request)
  order.push('second:after')
  return response
})

// Request: first:before → second:before → transport
// Return: second:after → first:after
void [first, second, order]
```

`withInterceptors(...)` を複数回呼ぶと追記されます。外側が最終結果を見る必要があるなら、広い観測を狭いミューテーション/リトライの外側に置いてください。

## クローンしてリクエストヘッダーを足す

入ってくる `HttpRequest` は鎖の所有物として扱います。変更する前に `Headers` をクローンし、新しいリクエストを `next` に渡します。

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

function readAccessToken(): string | undefined {
  return undefined
}

const bearer = createHttpInterceptor((request, next) => {
  const token = readAccessToken()
  if (!token) return next(request)

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return next({ ...request, headers })
})
```

SSE も同じパターンです。ブラウザー WebSocket は任意のハンドシェイクヘッダーを足せません — `request.headers` を変えてもブラウザーソケットは認証されません。プロトコル、URL/query 方針、サーバーが支持するハンドシェイクを使ってください。

HTTP ボディを差し替えるときは、コピーしたリクエストの `body` を差し替えます。ボディ値が変わると、Fetch は古い content-type メタデータを無視します。消費済みの `ReadableStream` ボディを再利用しないでください。

## リクエストをショートサーキットする

`next` を飛ばせますが、期待される結果型は返す必要があります。HTTP では `makeResponse(...)` が互換ラッパーを作ります。

```typescript twoslash
import { createHttpInterceptor, makeResponse } from '@defjs/core'

function isMaintenanceWindow(): boolean {
  return false
}

const maintenanceGate = createHttpInterceptor(async (_request, next) => {
  if (isMaintenanceWindow()) {
    return makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { message: 'Temporarily unavailable' },
    })
  }

  return next(_request)
})
```

コマンド層はそれでも status で振り分けます。呼び出し側が型付き `error.data` を要する場合は、非 2xx 側を一つの `error` struct で宣言してください。SSE や WebSocket のショートサーキットには、互換な完全なハンドル/セッション（閉鎖 promise、ライブ状態、所有権、`[Symbol.asyncDispose]`）が要ります。部分オブジェクトは有効な方針ではありません。構造的な `EventStreamHandle` と `WebSocketSessionLike` の実装には、今やコンパイル時にその標準 disposer が要ります。Defjs のハンドルを受け取るだけの利用者には、新しい実行時呼び出しは要りません。

## 安全な読み取りをリトライする

リトライは振る舞いを変えます。方針は狭く保ってください — この例は再生可能な `GET` / `HEAD` / `OPTIONS` を status `0`、`429`、`502`、`503`、`504` でリトライし、`Retry-After` を 30s で上限し、2 回のリトライ後または abort で止めます。

```typescript twoslash
import { createHttpInterceptor, type HttpRequest, type HttpResponse } from '@defjs/core'

const retryableMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const retryableStatuses = new Set([0, 429, 502, 503, 504])

function isReplayable(request: HttpRequest): boolean {
  return typeof ReadableStream === 'undefined' || !(request.body instanceof ReadableStream)
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get('retry-after')
  if (!value) return 250

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000)

  const date = Date.parse(value)
  return Number.isNaN(date) ? 250 : Math.min(Math.max(0, date - Date.now()), 30_000)
}

function waitForRetryAfter(response: HttpResponse<unknown>, signal?: AbortSignal): Promise<void> {
  const delay = retryAfterMs(response)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(done, delay)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason)
    }

    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (!retryableMethods.has(request.method.toUpperCase()) || !isReplayable(request)) return next(request)

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request)
    if (!retryableStatuses.has(response.status) || attempt >= 2) return response
    await waitForRetryAfter(response, request.abort)
  }
})
```

投げられたインターセプター/Fetch エラーは、このループではリトライしません。トランスポート失敗は reject するので、このループが照合できる status がそもそも出てきません。`POST` / `PUT` / `PATCH` / `DELETE` のリトライには、再生可能なバイト、サーバー側の支持、冪等性の契約、レビュー済み status 方針が要ります。リトライはあなたの責任です — Core は `retryAfter()` を公開しません。

このサンプルの外で throw（または reject）したインターセプターは、`EXT_INTERCEPTOR_FAILED` として
呼び出し側に返り、投げた値は `cause` に載ります — [エラー](./errors.md) を参照してください。
キャンセルを表したいときは、代わりに `ERR_ABORTED` か `ERR_TIMEOUT` を throw します。

`next(request)` は reject しえます。トランスポート失敗は fault であって status 0 のレスポンスでは
ないので、観測したいインターセプターは `next` を `try` / `catch` で囲みます。それでも Defjs の帰属は
正しいままです。トランスポート由来の reject は `NET_*` fault のままで、あなたのインターセプターの
せいにはなりません。

## WebSocket セッションを包む

WebSocket インターセプターは `next` を高々一度しか呼べません。セッションを包むなら、ライブ getter とライフサイクルメンバーを明示的に委譲します。

```typescript twoslash
import { createWebSocketInterceptor } from '@defjs/core'

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request)

  return {
    get bufferedAmount() {
      return session.bufferedAmount
    },
    get connection() {
      return session.connection
    },
    get state() {
      return session.state
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason)
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]()
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener)
    },
    onStateChange(listener) {
      return session.onStateChange(listener)
    },
    send(message: unknown) {
      session.send(message)
    },
  }
})
```

セッションを spread すると、`state` / `connection` / `bufferedAmount` は一度スナップショットされます。所有権を意図的に変えない限り、`closed`、`receive`、`close`、正確な `[Symbol.asyncDispose]()` の委譲、リスナー cleanup を保ってください。wrapper は内側セッションの teardown promise を返さなければならず、無関係な解決済み promise では足りません。鎖が作ったセッションが渡されなかったとき、Core はそれを settle して閉じます。成功したインターセプターが別のセッションを返したとき、Core は作られた方を捨てます。

## Reference

ファクトリはタグ付きトランスポート値を返します。

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — HTTP の Basic 資格情報
- `basicAuthSSEInterceptor(provider, options?)` — SSE の Basic 資格情報

`HttpRequest` には `endpoint`、`baseEndpoint`、`method`、`headers`、`body`、`queryParams`、`queryString`、`abort`、`timeout`、静的な `operation` が含まれることがあります。トランスポート統合の値であり、呼び出し側のパース済み入力ではありません。`queryParams` はシリアライズ後の `new URLSearchParams(queryString)` です。ビルダーが query を作らなかったとき、設定済みの query シリアライザは呼ばれません。ビルダーの `URLSearchParams` はそのまま使われます。コマンド検証、出力検証、ドメインエラー写像はそれぞれの層に置いてください。

SSE/WebSocket のオブザーバーはライフサイクルフックであり、制御フローではありません。所有者が終わるとき WebSocket リスナーを購読解除してください。オブザーバーの失敗はトランスポート契約に従います。インターセプター自体は throw や reject できます。

ログはレビュー済みの許可リストにします。静的 `operation`、method、status、所要時間、安定したエラーコード。解決済み URL、query 文字列、認証ヘッダー、ボディ、生の cause、SSE イベント ID、WebSocket ペイロードはデフォルトでログしないでください。

Basic 資格情報は base64 であり、暗号化ではありません。TLS を使い、サーバーでは資格情報プロバイダをリクエストスコープに保ち、生成ヘッダーをログしないでください。デフォルトエンコーダは `globalThis.btoa` です。ランタイムに `btoa` がない、またはレビュー済みエンコーダが要るときは `BasicAuthInterceptorOptions.encode` を渡してください。

インターセプターはトランスポート方針を強制できます。入力検証でも認可でも、リソース所有でもありません。長期の SSE/WebSocket 作業を始めたコードは、引き続き `await using` を使うか、手動でキャンセル、close、終端 promise の await をします。通常の HTTP は request-scoped で timeout / `AbortSignal` により管理され、`Client` は `AsyncDisposable` ではありません。

## 関連レシピ

- [401 で Bearer トークンを一度だけ更新する](../recipes/refresh-bearer-once.md)
- [execute を隠さずに HTTP SDK を公開する](../recipes/publish-http-sdk.md)
- [ローカル Fetch ハンドルでテストする](../recipes/test-with-handle.md)
- [HTTP 呼び出しをキャンセルする](../recipes/cancel-http.md)
