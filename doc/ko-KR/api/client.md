---
title: 클라이언트
description: createClient, option 헬퍼, Client 타입이에요.
---

# 클라이언트 {#page}

클라이언트를 만들고, 옵션을 왼쪽에서 오른쪽으로 조합한 뒤 HTTP / SSE / WebSocket 명령을 `execute` 해요.

## createClient() {#createClient}

```ts
function createClient(...options: ClientOption[]): Client
```

옵션은 순서대로 적용돼요. interceptor가 인증이나 테넌트를 클로저로 잡을 때는 요청 경계 안에서 클라이언트를 만드는 편이 좋아요.

- **options** — `withEndpoint` 같은 option 헬퍼예요.
- **반환** 전송마다 `execute`가 오버로드된 클라이언트예요.

```ts
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

## option 헬퍼

모든 헬퍼는 `ClientOption`을 돌려줘요.

### withEndpoint() {#withEndpoint}

```ts
function withEndpoint(endpoint: string): ClientOption
```

상대 path 앞에 붙는 base URL을 설정해요.

### withInterceptors() {#withInterceptors}

```ts
function withInterceptors(...interceptors: Interceptor[]): ClientOption
```

등록 순서대로 interceptor를 추가해요. 섞인 kind는 실행 시점에 전송별로 걸러져요.

### withQuerySerializer() {#withQuerySerializer}

```ts
function withQuerySerializer(serializer: QuerySerializer): ClientOption
```

HTTP, SSE, WebSocket의 query 인코딩을 바꿔요. `serializer(query)`는 **인코딩된 와이어 객체**(alias가 적용되고, `Date`는 ISO, `bigint`는 문자열)를 받고, 앞에 `?`가 없는 query 문자열을 돌려줘야 해요. 요청에 query가 없으면 호출되지 않아요. `URLSearchParams`를 돌려주는 builder는 이걸 건너뛰어요.

### withHTTPHandle() {#withHTTPHandle}

### withSSEHandle() {#withSSEHandle}

### withWebSocketHandle() {#withWebSocketHandle}

```ts
function withHTTPHandle(fetchImpl: typeof fetch): ClientOption
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption
```

Fetch(HTTP/SSE)나 WebSocket 생성자를 바꿔요.

### withCredentials() {#withCredentials}

```ts
function withCredentials(value: boolean): ClientOption
```

`true`이면 HTTP와 SSE에서 Fetch가 `credentials: 'include'`를 써요.

### withXSRF() {#withXSRF}

```ts
function withXSRF(options?: {
  cookieName?: string
  headerName?: string
  tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
}): ClientOption
```

XSRF 쿠키를 요청 헤더로 복사해요. 기본값: 쿠키 `XSRF-TOKEN`, 헤더 `X-XSRF-TOKEN`이에요.

### SSE 설정

### withSSEReconnect() {#withSSEReconnect}

### withSSEOnInvalidEvent() {#withSSEOnInvalidEvent}

```ts
function withSSEHandle(fetchImpl: typeof fetch): ClientOption
function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption
function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption
```

### WebSocket 설정

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

## 타입

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

SSE: `handle`, `onInvalidEvent`, `reconnect` (`attempts`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, `shouldReconnect`). SSE `jitter`는 WebSocket과 같은 0–1 곱셈 계수예요. SSE `reconnect`를 주면 `attempts` 기본값은 **3**이고, `attempts: 0`은 꺼요. `withSSEReconnect`를 빼도 재시도가 꺼져요.

WebSocket: `handle`, `beforeConnect`, `heartbeat` (`intervalMs`, `message`, `isAck`, `timeoutMs`), `protocols`, `reconnect` (SSE와 같은 모양에 close `code` / `reason` / `wasClean`을 더해요). WebSocket `reconnect`를 주면 `attempts` 기본값은 **3**이고, `0`은 꺼요. `attempts`를 빼도 무제한이 아니에요. WebSocket `jitter`는 0–1 곱셈 계수예요.

`ClientConfig`는 해석된 스냅샷이에요 (`endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …). `ClientOptions`는 입력 모양의 짝이에요.

[클라이언트 가이드](/core/client)를 보세요.

## ClientOptions {#ClientOptions}

입력 모양 config예요. `endpoint`, `http`, `sse`, `webSocket`, `interceptors`, …

## ClientConfig {#ClientConfig}

option 헬퍼를 적용한 뒤의 해석된 스냅샷이에요.

## ClientSSEConfig {#ClientSSEConfig}

`ClientConfig.sse`에 있는, 해석된 SSE config예요.

## WebSocketHandle {#WebSocketHandle}

전송이 쓰는 최소 WebSocket 인스턴스 면이에요.

## WebSocketHandleConstructor {#WebSocketHandleConstructor}

`withWebSocketHandle`에 넘기는 생성자예요.
