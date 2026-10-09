---
title: Cliente
description: createClient, helpers de opción y el tipo Client.
---

# Cliente {#page}

Crea un cliente, compón opciones de izquierda a derecha y luego `execute` comandos HTTP / SSE / WebSocket.

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

Las opciones se aplican en orden. Prefiere crear el cliente dentro del límite de la solicitud cuando los interceptores capturan auth o tenants.

- **options** — Helpers de opción como `withEndpoint`.
- **Devuelve** un cliente cuyo `execute` está sobrecargado por transporte.

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## Helpers de opción

Todos los helpers devuelven `ClientOption`.

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

Fija la URL base que se antepone a los paths relativos.

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

Añade interceptores en orden de registro. Los kinds mixtos se filtran por transporte en el momento de execute.

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

Reemplaza la codificación de query para HTTP, SSE y WebSocket. `serializer(query)` recibe el **objeto de cable ya codificado** (alias aplicados, `Date` como ISO, `bigint` como string) y debe devolver el query string sin un `?` inicial. No se llama cuando la solicitud no tiene query. Un builder que devuelve `URLSearchParams` lo salta.

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

Reemplaza Fetch (HTTP/SSE) o el constructor WebSocket.

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

Cuando es `true`, Fetch usa `credentials: 'include'` para HTTP y SSE.

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

Copia una cookie XSRF a una cabecera de solicitud. Por defecto: cookie `XSRF-TOKEN`, cabecera `X-XSRF-TOKEN`.

### Ajustes SSE

### withSSEReconnect() {#withSSEReconnect}

### withSSEOnInvalidEvent() {#withSSEOnInvalidEvent}

```ts
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption
function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption
```

### Ajustes WebSocket

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

## Tipos

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

SSE: `handle`, `onInvalidEvent`, `reconnect` (`attempts`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, `shouldReconnect`). El `jitter` de SSE es un factor multiplicativo 0–1, igual que WebSocket. Cuando `reconnect` de SSE está definido, `attempts` vale **3** por defecto; `attempts: 0` lo desactiva. Omitir `withSSEReconnect` también desactiva el reintento.

WebSocket: `handle`, `beforeConnect`, `heartbeat` (`intervalMs`, `message`, `isAck`, `timeoutMs`), `protocols`, `reconnect` (la misma forma que SSE más el close `code` / `reason` / `wasClean`). Cuando `reconnect` de WebSocket está definido, `attempts` vale **3** por defecto; `0` lo desactiva. Omitir `attempts` no significa ilimitado. El `jitter` de WebSocket es un factor multiplicativo 0–1.

`ClientConfig` es el snapshot resuelto (`endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …). `ClientOptions` es la contraparte con forma de input.

Mira la [guía de Cliente](/core/client).

## ClientOptions {#ClientOptions}

Config con forma de input: `endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …

## ClientConfig {#ClientConfig}

Snapshot resuelto después de aplicar los option helpers.

## ClientSSEConfig {#ClientSSEConfig}

Config SSE resuelto en `ClientConfig.sse`.

## WebSocketHandle {#WebSocketHandle}

Superficie mínima de instancia WebSocket que usa el transporte.

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

Constructor que le pasas a `withWebSocketHandle`.
