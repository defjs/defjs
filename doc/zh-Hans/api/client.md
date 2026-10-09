---
title: Client
description: createClient、option helpers，以及 Client 类型。
---

# Client {#page}

建一个 client，options 从左到右叠，然后 `execute` HTTP / SSE / WebSocket command。

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

Options 按顺序生效。interceptor 闭包会抓住鉴权或租户时，把 client 建在请求边界里。

- **options** — 像 `withEndpoint` 这种 option helper。
- **返回** 一个 client，`execute` 按传输重载。

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## 选项 helpers

每个 helper 都返回 `ClientOption`。

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

相对路径前面拼上的 base URL。

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

按注册顺序追加 interceptor。混着的 kind 在 execute 时按传输过滤。

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

换掉 HTTP、SSE、WebSocket 的 query 编码。`serializer(query)` 收到的是**已经编码的线上对象**（alias 已应用，`Date` 为 ISO，`bigint` 为 string），必须返回 query string，不要带前导 `?`。请求没有 query 时不会调用。builder 返回 `URLSearchParams` 时会跳过它。

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

替换 Fetch（HTTP/SSE）或 WebSocket 构造函数。

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

为 `true` 时，HTTP 和 SSE 的 Fetch 用 `credentials: 'include'`。

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

把 XSRF cookie 抄到请求 header。默认 cookie `XSRF-TOKEN`，header `X-XSRF-TOKEN`。

### SSE 旋钮

### withSSEReconnect() {#withSSEReconnect}

### withSSEOnInvalidEvent() {#withSSEOnInvalidEvent}

```ts
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption
function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption
```

### WebSocket 旋钮

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

## 类型

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

SSE：`handle`、`onInvalidEvent`、`reconnect`（`attempts`、`delayMs`、`factor`、`jitter`、`maxDelayMs`、`shouldReconnect`）。SSE `jitter` 是 0–1 的乘性因子，和 WebSocket 一样。设了 SSE `reconnect` 时，`attempts` 默认 **3**；`attempts: 0` 禁用。不写 `withSSEReconnect` 同样禁用重试。

WebSocket：`handle`、`beforeConnect`、`heartbeat`（`intervalMs`、`message`、`isAck`、`timeoutMs`）、`protocols`、`reconnect`（形状和 SSE 一样，再加 close 的 `code` / `reason` / `wasClean`）。设了 WebSocket `reconnect` 时，`attempts` 默认 **3**；`0` 禁用。省略 `attempts` 不是无限次。WebSocket `jitter` 是 0–1 的乘性因子。

`ClientConfig` 是解析完的快照（`endpoint`、`http`、`sse`、`webSocket`、`interceptors`、…）。`ClientOptions` 是输入形状那一侧。

见 [Client 指南](/core/client)。

## ClientOptions {#ClientOptions}

输入形态的 config：`endpoint`、`http`、`sse`、`webSocket`、`interceptors`…

## ClientConfig {#ClientConfig}

option helpers 跑完之后的快照。

## ClientSSEConfig {#ClientSSEConfig}

`ClientConfig.sse` 上已经解析好的 SSE config。

## WebSocketHandle {#WebSocketHandle}

传输层用的最小 WebSocket 实例面。

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

传给 `withWebSocketHandle` 的构造函数。
