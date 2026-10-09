---
title: Client
description: createClient, Option-Helper und der Client-Type.
---

# Client {#page}

Erzeuge einen Client, komponiere Options von links nach rechts, dann `execute` HTTP- / SSE- / WebSocket-Commands.

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

Options gelten in Reihenfolge. Erzeuge den Client lieber innerhalb der Request-Grenze, wenn Interceptors Auth oder Tenants closen.

- **options** — Option-Helper wie `withEndpoint`.
- **Returns** einen Client, dessen `execute` pro Transport overloaded ist.

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## Option-Helfer

Alle Helper geben `ClientOption` zurück.

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

Setzt die Base-URL, die den relativen Paths vorangestellt wird.

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

Hängt Interceptors in Registration-Order an. Gemischte Kinds werden zur Execute-Zeit nach Transport gefiltert.

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

Ersetzt Query-Encoding für HTTP, SSE und WebSocket. `serializer(query)` bekommt das **encodierte Wire-Objekt** (Aliasse angewandt, `Date` als ISO, `bigint` als String) und muss den Query-String ohne führendes `?` zurückgeben. Ohne Query wird er nicht aufgerufen. Ein Builder, der `URLSearchParams` zurückgibt, überspringt ihn.

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

Ersetzt Fetch (HTTP/SSE) oder den WebSocket-Constructor.

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

Wenn `true`, nutzt Fetch `credentials: 'include'` für HTTP und SSE.

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

Kopiert ein XSRF-Cookie auf einen Request-Header. Defaults: Cookie `XSRF-TOKEN`, Header `X-XSRF-TOKEN`.

### SSE-Optionen

### withSSEReconnect() {#withSSEReconnect}

### withSSEOnInvalidEvent() {#withSSEOnInvalidEvent}

```ts
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption
function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption
```

### WebSocket-Optionen

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

## Typen

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

SSE: `handle`, `onInvalidEvent`, `reconnect` (`attempts`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, `shouldReconnect`). SSE-`jitter` ist ein multiplikativer Faktor von 0–1, genau wie bei WebSocket. Ist SSE-`reconnect` gesetzt, ist der Default für `attempts` **3**; `attempts: 0` schaltet aus. `withSSEReconnect` weglassen schaltet Retry ebenfalls aus.

WebSocket: `handle`, `beforeConnect`, `heartbeat` (`intervalMs`, `message`, `isAck`, `timeoutMs`), `protocols`, `reconnect` (gleiche Shape wie SSE plus Close `code` / `reason` / `wasClean`). Ist WebSocket-`reconnect` gesetzt, ist der Default für `attempts` **3**; `0` schaltet aus. `attempts` weglassen heißt nicht unbegrenzt. WebSocket-`jitter` ist ein multiplikativer Faktor von 0–1.

`ClientConfig` ist der resolved Snapshot (`endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …). `ClientOptions` ist das input-förmige Gegenstück.

Siehe [Client-Guide](/core/client).

## ClientOptions {#ClientOptions}

Input-förmiges Config: `endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …

## ClientConfig {#ClientConfig}

Aufgelöster Snapshot, nachdem die Option-Helper angewandt wurden.

## ClientSSEConfig {#ClientSSEConfig}

Aufgelöstes SSE-Config auf `ClientConfig.sse`.

## WebSocketHandle {#WebSocketHandle}

Minimale WebSocket-Instanzfläche, die der Transport nutzt.

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

Konstruktor, den du an `withWebSocketHandle` übergibst.
