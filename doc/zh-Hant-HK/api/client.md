---
title: Client
description: createClient、option helpers，同 Client type。
---

# Client {#page}

Create 一個 client，options 由左到右 compose，之後 `execute` HTTP / SSE / WebSocket commands。

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

Options 按次序套用。如果 interceptors close over auth 或者 tenants，prefer 喺 request boundary 入面 create client。

- **options** — Option helpers，例如 `withEndpoint`。
- **Returns** 一個 client，佢嘅 `execute` 按 transport overload。

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## Option helpers

所有 helpers 都 return `ClientOption`。

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

Set 相對 paths 前面 prepend 嘅 base URL。

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

按 registration order append interceptors。Mixed kinds 會喺 execute 時按 transport filter。

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

換走 HTTP、SSE 同 WebSocket 嘅 query encoding。`serializer(query)` 收到嘅係**已經 encode 嘅 wire object**（aliases 已套用，`Date` 係 ISO，`bigint` 係 string），一定要 return query string，而且唔可以有 leading `?`。Request 冇 query 嘅時候唔會 call。Builder return `URLSearchParams` 就會 skip 佢。

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

換走 Fetch（HTTP/SSE）或者 WebSocket constructor。

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

`true` 嘅時候，HTTP 同 SSE 嘅 Fetch 會用 `credentials: 'include'`。

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

將 XSRF cookie copy 去 request header。Defaults：cookie `XSRF-TOKEN`，header `X-XSRF-TOKEN`。

### SSE knobs

### withSSEReconnect() {#withSSEReconnect}

### withSSEOnInvalidEvent() {#withSSEOnInvalidEvent}

```ts
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption
function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption
```

### WebSocket knobs

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

## Types

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

SSE：`handle`、`onInvalidEvent`、`reconnect`（`attempts`、`delayMs`、`factor`、`jitter`、`maxDelayMs`、`shouldReconnect`）。SSE `jitter` 係 0–1 multiplicative factor，同 WebSocket 一樣。SSE `reconnect` 有 set 嘅時候，`attempts` 預設係 **3**；`attempts: 0` 就停用。唔寫 `withSSEReconnect` 亦會停用 retry。

WebSocket：`handle`、`beforeConnect`、`heartbeat`（`intervalMs`、`message`、`isAck`、`timeoutMs`）、`protocols`、`reconnect`（shape 同 SSE 一樣，再加 close 嘅 `code` / `reason` / `wasClean`）。WebSocket `reconnect` 有 set 嘅時候，`attempts` 預設係 **3**；`0` 就停用。唔寫 `attempts` 唔代表無限。WebSocket `jitter` 係 0–1 multiplicative factor。

`ClientConfig` 係 resolved snapshot（`endpoint`、`http`、`sse`、`webSocket`、`interceptors`、…）。`ClientOptions` 係 input-shaped 嗰邊。

睇 [Client guide](/core/client)。

## ClientOptions {#ClientOptions}

輸入形態嘅 config：`endpoint`、`http`、`sse`、`webSocket`、`interceptors`、…

## ClientConfig {#ClientConfig}

option helpers 套完之後嘅 resolved snapshot。

## ClientSSEConfig {#ClientSSEConfig}

`ClientConfig.sse` 上面解析好嘅 SSE config。

## WebSocketHandle {#WebSocketHandle}

Transport 用嗰個最細 WebSocket instance surface。

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

傳畀 `withWebSocketHandle` 嘅 constructor。
