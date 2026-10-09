---
title: Client
description: createClient, helpers d’options, et le type Client.
---

# Client {#page}

Crée un client, compose les options de gauche à droite, puis `execute` des commandes HTTP / SSE / WebSocket.

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

Les options s’appliquent dans l’ordre. Préfère créer le client dans la frontière de la requête quand les intercepteurs capturent auth ou tenants.

- **options** — Helpers d’options comme `withEndpoint`.
- **Renvoie** un client dont `execute` est overloadé par transport.

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## Helpers d’option

Tous les helpers renvoient `ClientOption`.

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

Pose l’URL de base préfixée aux paths relatifs.

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

Append les intercepteurs dans l’ordre d’enregistrement. Les kinds mixtes sont filtrés par transport à l’execute.

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

Remplace l’encodage de query pour HTTP, SSE et WebSocket. `serializer(query)` reçoit l’**objet wire déjà encodé** (alias appliqués, `Date` en ISO, `bigint` en string) et doit renvoyer la query string sans `?` initial. Il n’est pas appelé quand la requête n’a pas de query. Un builder qui renvoie `URLSearchParams` le saute.

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

Remplace Fetch (HTTP/SSE) ou le constructeur WebSocket.

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

Quand `true`, Fetch utilise `credentials: 'include'` pour HTTP et SSE.

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

Copie un cookie XSRF sur un en-tête de requête. Défauts : cookie `XSRF-TOKEN`, en-tête `X-XSRF-TOKEN`.

### Réglages SSE

### withSSEReconnect() {#withSSEReconnect}

### withSSEOnInvalidEvent() {#withSSEOnInvalidEvent}

```ts
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption
function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption
```

### Réglages WebSocket

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

SSE : `handle`, `onInvalidEvent`, `reconnect` (`attempts`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, `shouldReconnect`). Le `jitter` SSE est un facteur multiplicatif 0–1, comme WebSocket. Quand `reconnect` SSE est posé, `attempts` vaut **3** par défaut ; `attempts: 0` désactive. Omettre `withSSEReconnect` désactive aussi le retry.

WebSocket : `handle`, `beforeConnect`, `heartbeat` (`intervalMs`, `message`, `isAck`, `timeoutMs`), `protocols`, `reconnect` (même forme que SSE, plus `code` / `reason` / `wasClean` de close). Quand `reconnect` WebSocket est posé, `attempts` vaut **3** par défaut ; `0` désactive. Omettre `attempts` n’est pas illimité. Le `jitter` WebSocket est un facteur multiplicatif 0–1.

`ClientConfig` est l’instantané résolu (`endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …). `ClientOptions` est la contrepartie en forme d’entrée.

Voir le [guide Client](/core/client).

## ClientOptions {#ClientOptions}

Config en forme d’entrée : `endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …

## ClientConfig {#ClientConfig}

Instantané résolu après application des helpers d’options.

## ClientSSEConfig {#ClientSSEConfig}

Config SSE résolue sur `ClientConfig.sse`.

## WebSocketHandle {#WebSocketHandle}

Surface minimale d’instance WebSocket utilisée par le transport.

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

Constructeur passé à `withWebSocketHandle`.
