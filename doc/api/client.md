---
title: Client
description: createClient, option helpers, and the Client type.
---

# Client {#page}

Create a client, compose options left to right, then `execute` HTTP / SSE / WebSocket commands.

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

Options apply in order. Prefer creating the client inside the request boundary when interceptors close over auth or tenants.

- **options** — Option helpers such as `withEndpoint`.
- **Returns** a client whose `execute` is overloaded per transport.

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## Option helpers

All helpers return `ClientOption`.

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

Sets the base URL prepended to relative paths.

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

Appends interceptors in registration order. Mixed kinds are filtered per transport at execute time.

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

Replaces query encoding for HTTP, SSE, and WebSocket. `serializer(query)` receives the **encoded wire object** (aliases applied, `Date` as ISO, `bigint` as string) and must return the query string without a leading `?`. It is not called when the request has no query. A builder that returns `URLSearchParams` skips it.

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

Replace Fetch (HTTP/SSE) or the WebSocket constructor.

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

When `true`, Fetch uses `credentials: 'include'` for HTTP and SSE.

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

Copies an XSRF cookie onto a request header. Defaults: cookie `XSRF-TOKEN`, header `X-XSRF-TOKEN`.

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

SSE: `handle`, `onInvalidEvent`, `reconnect` (`attempts`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, `shouldReconnect`). SSE `jitter` is a 0–1 multiplicative factor, same as WebSocket. When SSE `reconnect` is set, `attempts` defaults to **3**; `attempts: 0` disables. Omitting `withSSEReconnect` also disables retry.

WebSocket: `handle`, `beforeConnect`, `heartbeat` (`intervalMs`, `message`, `isAck`, `timeoutMs`), `protocols`, `reconnect` (same shape as SSE plus close `code` / `reason` / `wasClean`). When WebSocket `reconnect` is set, `attempts` defaults to **3**; `0` disables. Omitting `attempts` is not unlimited. WebSocket `jitter` is a 0–1 multiplicative factor.

`ClientConfig` is the resolved snapshot (`endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …). `ClientOptions` is the input-shaped counterpart.

See [Client guide](/core/client).

## ClientOptions {#ClientOptions}

Input-shaped config: `endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …

## ClientConfig {#ClientConfig}

Resolved snapshot after option helpers apply.

## ClientSSEConfig {#ClientSSEConfig}

Resolved SSE config on `ClientConfig.sse`.

## WebSocketHandle {#WebSocketHandle}

Minimal WebSocket instance surface used by the transport.

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

Constructor passed to `withWebSocketHandle`.
