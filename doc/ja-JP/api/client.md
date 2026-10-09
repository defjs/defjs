---
title: Client
description: createClient、option ヘルパー、Client 型です。
---

# Client {#page}

クライアントを作り、options を左から右へ合成して、HTTP / SSE / WebSocket コマンドを `execute` します。

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

options は順に適用されます。インターセプターが auth やテナントを掴むなら、クライアントはリクエスト境界の中で作ってください。

- **options** — `withEndpoint` のような option ヘルパーです。
- **戻り値** `execute` がトランスポートごとにオーバーロードされたクライアントです。

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## option ヘルパー

どのヘルパーも `ClientOption` を返します。

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

相対 path の前に付けるベース URL をセットします。

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

登録順でインターセプターを追記します。混在の kind は execute 時にトランスポートごとにフィルタされます。

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

HTTP、SSE、WebSocket の query エンコードを差し替えます。`serializer(query)` は**エンコード済みのワイヤオブジェクト**（エイリアス適用済み、`Date` は ISO、`bigint` は文字列）を受け取り、先頭の `?` なしの query 文字列を返す必要があります。リクエストに query が無いときは呼ばれません。`URLSearchParams` を返すビルダーはこれを飛ばします。

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

Fetch（HTTP/SSE）または WebSocket コンストラクタを差し替えます。

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

`true` のとき、HTTP と SSE の Fetch は `credentials: 'include'` を使います。

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

XSRF cookie をリクエストヘッダーへコピーします。デフォルトは cookie `XSRF-TOKEN`、ヘッダー `X-XSRF-TOKEN` です。

### SSE の設定

### withSSEReconnect() {#withSSEReconnect}

### withSSEOnInvalidEvent() {#withSSEOnInvalidEvent}

```ts
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption
function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption
```

### WebSocket の設定

### withWebSocketBeforeConnect() {#withWebSocketBeforeConnect}

### withWebSocketProtocols() {#withWebSocketProtocols}

### withWebSocketHeartbeat() {#withWebSocketHeartbeat}

### withWebSocketReconnect() {#withWebSocketReconnect}

```ts
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
function withWebSocketBeforeConnect(beforeConnect: ClientWebSocketOptions['beforeConnect']): ClientOption
function withWebSocketProtocols(protocols: readonly string[]): ClientOption
function withWebSocketHeartbeat(options: ClientWebSocketOptions['heartbeat']): ClientOption
function withWebSocketReconnect(options: ClientWebSocketOptions['reconnect']): ClientOption
```

## 型

### Client {#Client}

```ts
type Client = {
  execute(command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
  execute(command: EventStreamCommand, options?: EventStreamExecuteOptions): Promise<StreamAwaitResult>
  execute(command: WebSocketCommand, options?: WebSocketExecuteOptions): Promise<SocketAwaitResult>
}
```

### ClientOption {#ClientOption}

```ts
type ClientOption = (config: ClientConfig) => void
```

### QuerySerializer {#QuerySerializer}

```ts
type QuerySerializer = (query: { [key: string]: unknown }) => string
```

### ClientSSEOptions {#ClientSSEOptions}

### ClientWebSocketOptions {#ClientWebSocketOptions}

SSE は `handle`、`onInvalidEvent`、`reconnect`（`attempts`、`delayMs`、`factor`、`jitter`、`maxDelayMs`、`shouldReconnect`）です。SSE の `jitter` は WebSocket と同じ、0–1 の乗法因子です。SSE の `reconnect` を置いたとき、`attempts` のデフォルトは **3** です。`attempts: 0` は無効にします。`withSSEReconnect` を省いてもリトライは無効です。

WebSocket は `handle`、`beforeConnect`、`heartbeat`（`intervalMs`、`message`、`isAck`、`timeoutMs`）、`protocols`、`reconnect`（SSE と同じ形に、close の `code` / `reason` / `wasClean`）です。WebSocket の `reconnect` を置いたとき、`attempts` のデフォルトは **3** です。`0` は無効にします。`attempts` を省いても無制限にはなりません。WebSocket の `jitter` は 0–1 の乗法因子です。

`ClientConfig` は解決済みスナップショット（`endpoint`、`http`、`sse`、`webSocket`、`interceptors`、…）です。`ClientOptions` は入力側の形です。

[Client ガイド](/core/client) を見てください。

## ClientOptions {#ClientOptions}

入力側の config です。`endpoint`、`http`、`sse`、`webSocket`、`interceptors`、…

## ClientConfig {#ClientConfig}

option ヘルパーを当てたあとの、解決済みスナップショットです。

## ClientSSEConfig {#ClientSSEConfig}

`ClientConfig.sse` に載っている、解決済みの SSE config です。

## WebSocketHandle {#WebSocketHandle}

トランスポートが使う、最小限の WebSocket インスタンス面です。

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

`withWebSocketHandle` に渡すコンストラクタです。
