---
title: OpenTelemetry server
description: 自分の Tracer と任意の Meter で、アウトバウンドの Defjs トランスポート計測を有効にします。
---

# OpenTelemetry server

クライアント作成時にアウトバウンド計測を有効にします。`@defjs/opentelemetry-server` は HTTP、SSE、WebSocket のインターセプターを追記します。インバウンドのサーバー計測では**なく**、OpenTelemetry SDK の初期化もし**ません**。

## Basic Setup

SDK は別途初期化します。その API オブジェクトを渡します。

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { metrics, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const meter = metrics.getMeter('orders-service')
const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer, meter }))

const [error] = await client.execute(readOrders())
if (error) console.error(error.code)
```

`tracer` は必須です。`meter` は任意 — 省略するとパッケージメトリクスは無効です。`propagator` なし → アダプタは複合の W3C Trace Context + W3C Baggage propagator を作ります。グローバル SDK 設定の読み取りや初期化はしません。

`withOpenTelemetryServer(options)` は core の `ClientOption` を返します。`createClient` 時に適用し、有効なトランスポートごとにインターセプターを 1 つ追記します。HTTP、SSE、WebSocket はデフォルト有効。`{ enabled: false }` で 1 トランスポートを無効にします。

アダプタは、リクエストがトランスポート層で失敗してもトランスポートテレメトリを作れます。何かがエクスポートされるかは、あなたの SDK と exporter 次第です。

## スコープ

SDK の init、プロバイダ、exporter、プロセッサ、コンテキスト、サンプリング、redaction、flush、shutdown は呼び出し側の所有です。このパッケージは、渡された `Tracer`、任意の `Meter`、任意の `TextMapPropagator` を消費します。redactor や sensitive-key policy は内蔵しません。

キャッシュ、リトライ、メッセージ単位スパン、アプリのコマンド結果方針はありません。サーバー側 Node.js 向けです。公開パッケージは Node.js 22+、ピアは `@defjs/core`、`@opentelemetry/api` 1.x、`@opentelemetry/core` 2.x が要ります。

公開 API: `withOpenTelemetryServer` と `OpenTelemetryServerOptions`、`OpenTelemetryServerHttpOptions`、`OpenTelemetryServerSSEOptions`、`OpenTelemetryServerWebSocketOptions`。

## options とフック

フックは変更する transport の隣に置きます。同期 `startSpanHook(request)` は span 作成前に実行されて初期 `Attributes` を返し、application 属性は最後に適用されるので built-in を上書きできます。`requestHook` と `responseHook` は作成済み span を受け、`void` または Promise を返せます。hook failure は `defjs.otel.hook.error` を記録しても操作を止めず、start hook failure は built-in 属性へフォールバックします。

```typescript twoslash
import { createClient, createResolvedRequestUrl, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    http: {
      startSpanHook(request) {
        const attributes = { 'app.operation': request.operation ?? 'unclassified' }
        if (!request.baseEndpoint) return attributes
        const url = createResolvedRequestUrl(request.baseEndpoint, request.endpoint)
        if (request.queryString) url.search = request.queryString
        url.searchParams.delete('access_token')
        return { ...attributes, 'url.full': url.href }
      },
      requestHook(span, request) {
        span.setAttribute('app.request.started', true)
      },
      responseHook(span, response) {
        span.setAttribute('app.status', response.status)
      },
    },
    sse: { enabled: false },
    webSocket: { enabled: false },
  }),
)

void client
```

フック署名:

- 3 transport 共通: `startSpanHook(request): Attributes`（同期、span 作成前）
- HTTP: `requestHook(span, request)` と `responseHook(span, response, request)`
- SSE: `requestHook(span, request)` と `responseHook(span, stream, request)`
- WebSocket: `requestHook(span, request)` と `responseHook(span, session, request)`

空のトランスポートオブジェクトはそのトランスポートを有効にします。古い boolean のトランスポートスイッチと古いトップレベルフックは拒否されます — トランスポート options オブジェクトとトランスポートスコープのフックを使ってください。

## operation の同一性と伝播

コマンドに安定した同一性があるとき、`defineRequest`、`defineEventStream`、`defineWebSocket` に静的な `operation` を付けます。アダプタは span 名と `defjs.operation` に使います。解決済み path、識別子、テナント、query 文字列から同一性を導出しません。

```typescript twoslash
import { defineEventStream, defineRequest, defineWebSocket, struct } from '@defjs/core'

const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})
const orderEvents = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  operation: 'orders.watch',
  path: '/orders/events',
  events: { update: struct.object({ id: struct.number() }) },
})
const orderSocket = defineWebSocket({
  maxIncomingQueueSize: 100,
  operation: 'orders.connect',
  path: '/orders/socket',
  incoming: struct.object({ id: struct.number() }),
})

void readOrders
void orderEvents
void orderSocket
```

span 名は `GET orders.read`、`SSE orders.watch`、`WebSocket orders.connect` になります。`operation` なしのフォールバックは method / `SSE` / `WebSocket` で、`defjs.operation` は省略されます。

HTTP と SSE は伝播フィールドをリクエストヘッダーに注入します。既存の `Headers` インスタンスは再利用してミューテートし、なければ新しい `Headers` を作ります。WebSocket の query 伝播は**オプトイン**です（ブラウザーは任意のハンドシェイクヘッダーを足せません）。

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    webSocket: { queryPropagation: true },
  }),
)
```

`queryPropagation` があると、propagator フィールドが接続 query 文字列に追記されます。先に URL ログ、プロキシ可視性、アクセスログ、baggage、保持を見直してください。`requireParentSpan: true` はアクティブな親がないとき、span 作成・伝播・フック・メトリクスを飛ばし、`next` をそのまま呼びます。

## HTTP、SSE、WebSocket の意味論

アダプタが測るのはトランスポート寿命であり、コマンド解釈の全段階ではありません。

- **HTTP** — span は HTTP インターセプターで始まり、Defjs の `HttpResponse` を得た時点で終わります。メディアタイプの確認、表現の読み取り、Struct のデコードはすべてそのあとなので、後から出た `RES_*` fault は終了済みのトランスポート span を更新できません。また span はチェーンの内側で生きているため、トランスポートの reject は OTel の慣例どおり例外クラスとして記録され、実行があとで割り当てる fault コードにはなりません。
- **SSE** — span は `stream.closed` が確定するまで開いたままです。`sse.connected`、その後 `sse.closed` / `sse.aborted` / `sse.error` を記録します。1 論理ストリーム（再接続含む）→ 1 span。イベント単位の span はありません。
- **WebSocket** — span は `session.closed` が確定するまで開いたままです。イベント: `websocket.connected`、`websocket.closed`、`websocket.error`。再接続する物理ソケットは論理セッションの一部のままです。メッセージ単位の span はありません。

最終のコマンド結果が、トランスポートだけより要るなら、`client.execute(...)` をアプリ span で包みます。

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
const readOrders = defineRequest({ method: 'GET', operation: 'orders.read', path: '/orders' })

const outcome = await tracer.startActiveSpan('orders.command', async (span) => {
  try {
    const outcome = await client.execute(readOrders())
    const [error] = outcome
    if (error) {
      span.setAttribute('error.type', error.code)
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    return outcome
  } finally {
    span.end()
  }
})

void outcome
```

外側の span はあなたのもの。プラグインはそれでも低レベルのトランスポート span を報告します — 問いが二つあります。

## Reference

`meter` を渡したとき:

| メトリクス                                   | 意味                                              |
| -------------------------------------------- | ------------------------------------------------- |
| `http.client.request.duration`               | HTTP リクエスト所要時間（秒）                     |
| `defjs.client.sse.connect.duration`          | SSE ハンドル返却までの時間                        |
| `defjs.client.sse.connection.duration`       | ハンドル返却 → 終端 close                         |
| `defjs.client.sse.active_streams`            | 保留中の `closed` を持つ論理 SSE ハンドル         |
| `defjs.client.websocket.connect.duration`    | WebSocket セッション返却までの時間                |
| `defjs.client.websocket.connection.duration` | セッション返却 → 終端 close                       |
| `defjs.client.websocket.active_connections`  | 保留中の `closed` を持つ論理 WebSocket セッション |

アクティブな SSE/WebSocket 計測は論理リソース（再接続ギャップ含む）を数え、物理ソケットや個別 HTTP 試行は数えません。

HTTP span は method、解決済み `url.full`、利用可能ならサーバー address/port、受信時のレスポンス status を記録します。デフォルトの `url.full` は任意の `request.baseEndpoint` に対して `request.endpoint` を解決するだけで、独立した `request.queryString` を追加しません。これは構築境界であって redaction ではありません。完全またはマスク済みの application URL は `startSpanHook` で作ります。status `400+` → span status `ERROR`、status 文字列を `error.type` に。status `100..399` は span status を未設定のまま。status 0 のトランスポート結果にはレスポンス status がありません。キャンセルは status 未設定のまま。タイムアウト/その他のトランスポート失敗は `NET_TIMEOUT` または `NET_UNREACHABLE` を使います。メトリクスの次元は安定したものです。method、静的 operation、サーバー address/port、レスポンス status、低カーディナリティの error type。

SSE/WebSocket の接続メトリクスは接続時間、論理接続寿命、アクティブリソース数、`defjs.result`、operation、サーバー address/port、低カーディナリティの失敗型を記録します。リクエスト/レスポンスボディ、メッセージペイロード、キュー長、メッセージ単位 span はデフォルトではありません。

`url.full` と `recordException(...)` は機微になり得るものとして扱ってください。Defjs は自動 redact しません。operation 名とフック属性は許可リストに保ち、`startSpanHook` または SDK のプロセッサ/exporter で redact してください。プライバシー、カーディナリティ、保持、redaction を見直さずに、生 URL、query 文字列、ヘッダー、baggage、ペイロードをカスタムテレメトリへコピーしないでください。

WebSocket の query 伝播は、トレースコンテキストと baggage をブラウザー、プロキシ、アクセスログ、テレメトリに晒し得ます。資格情報チャネルではありません。`withCredentials(true)` は HTTP/SSE の Fetch 資格情報であり — WebSocket 認証ではありません。

アダプタは SDK の init/shutdown をせず、core クライアントやトランスポートハンドルも破棄しません。テレメトリの flush と、HTTP/SSE/WebSocket 作業の close は呼び出し側です。[Interceptors](../core/interceptors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md) を見てください。

## 関連レシピ

- [ローカル Fetch ハンドルでテストする](../recipes/test-with-handle.md)
- [SSE ストリームを消費する](../recipes/consume-sse.md)
- [WebSocket セッションを開く](../recipes/websocket-session.md)
