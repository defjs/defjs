---
title: Client
description: createClient、option helpers，以及 Client 型別。
---

# Client {#page}

建立 client，options 由左到右組合，再 `execute` HTTP／SSE／WebSocket commands。

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

Options 依序套用。若 interceptors 會捕捉 auth 或 tenants，請在請求邊界內建立 client。

- **options** — 像 `withEndpoint` 這類 option helpers。
- **回傳** `execute` 依傳輸 overload 的 client。

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## 選項 helpers

所有 helpers 都回傳 `ClientOption`。

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

設定會接到相對 path 前面的 base URL。

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

依註冊順序追加 interceptors。混合的 kinds 在執行時依傳輸篩選。

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

替換 HTTP、SSE、WebSocket 的 query 編碼。`serializer(query)` 收到的是**已編碼的 wire 物件**（已套用 aliases、`Date` 為 ISO、`bigint` 為字串），必須回傳不含開頭 `?` 的 query string。Request 沒有 query 時不會呼叫它。Builder 回傳 `URLSearchParams` 時會跳過它。

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

替換 Fetch（HTTP／SSE）或 WebSocket constructor。

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

為 `true` 時，HTTP／SSE 的 Fetch 用 `credentials: 'include'`。

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

把 XSRF cookie 複製到 request header。預設：cookie `XSRF-TOKEN`，header `X-XSRF-TOKEN`。

### SSE 旋鈕

### withSSEReconnect() {#withSSEReconnect}

### withSSEOnInvalidEvent() {#withSSEOnInvalidEvent}

```ts
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption
function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption
```

### WebSocket 旋鈕

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

## 型別

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

SSE：`handle`、`onInvalidEvent`、`reconnect`（`attempts`、`delayMs`、`factor`、`jitter`、`maxDelayMs`、`shouldReconnect`）。SSE 的 `jitter` 是 0–1 的乘性因子，跟 WebSocket 一樣。設定了 SSE `reconnect` 時，`attempts` 預設是 **3**；`attempts: 0` 停用。省略 `withSSEReconnect` 也會停用重試。

WebSocket：`handle`、`beforeConnect`、`heartbeat`（`intervalMs`、`message`、`isAck`、`timeoutMs`）、`protocols`、`reconnect`（形狀跟 SSE 一樣，再加上 close 的 `code`／`reason`／`wasClean`）。設定了 WebSocket `reconnect` 時，`attempts` 預設是 **3**；`0` 停用。省略 `attempts` 不是無限次。WebSocket 的 `jitter` 是 0–1 的乘性因子。

`ClientConfig` 是解析後的快照（`endpoint`、`http`、`sse`、`webSocket`、`interceptors`、…）。`ClientOptions` 是 input 形狀的對應型別。

見 [Client 指南](/core/client)。

## ClientOptions {#ClientOptions}

輸入形態的 config：`endpoint`、`http`、`sse`、`webSocket`、`interceptors`…

## ClientConfig {#ClientConfig}

option helpers 套用完後的快照。

## ClientSSEConfig {#ClientSSEConfig}

`ClientConfig.sse` 上解析好的 SSE config。

## WebSocketHandle {#WebSocketHandle}

傳輸層用的最小 WebSocket 實例面。

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

傳給 `withWebSocketHandle` 的建構函式。
