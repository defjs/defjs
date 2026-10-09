import type { Interceptor } from '../interceptor/interceptor'
import { validateTransportTimeout } from '../internal/abort'
import type {
  ClientConfig,
  ClientSSEOptions,
  ClientWebSocketOptions,
  FetchHandle,
  HttpClientOptions,
  QuerySerializer,
  WebSocketHandleConstructor,
} from './config'

/** Mutates `ClientConfig` when applied by `createClient`. */
export type ClientOption = (config: ClientConfig) => void

/**
 * Sets the base URL prepended to relative request paths.
 *
 * @param endpoint - Absolute or relative base endpoint.
 * @returns An option that writes `config.endpoint`.
 */
export function withEndpoint(endpoint: string): ClientOption {
  return (config) => {
    config.endpoint = endpoint
  }
}

/**
 * Sets static default headers for HTTP/SSE requests built by this client.
 *
 * Builder `headers` override the same names. HMAC and
 * dynamic Bearer tokens still belong in interceptors (they need the serialized body
 * or a refreshed credential).
 *
 * @param headers - `HeadersInit` bag cloned onto the client config.
 * @returns An option that writes `config.headers`.
 */
export function withHeaders(headers: HeadersInit): ClientOption {
  return (config) => {
    config.headers = new Headers(headers)
  }
}

/**
 * Sets the default timeout for HTTP `execute` only.
 *
 * Timeout is applied before the interceptor chain (`mergeAbortSignals`). Execute
 * `{ timeout }` overrides this default. Execute `{ abort }` combines with the
 * default (abort → `ABORTED`, timer → `TIMEOUT`). SSE and WebSocket ignore this
 * option. XOR still rejects execute options that pass both `abort` and `timeout`.
 *
 * @param ms - Positive safe integer timeout in milliseconds.
 * @returns An option that writes `config.timeout`.
 */
export function withTimeout(ms: number): ClientOption {
  validateTransportTimeout(ms)
  return (config) => {
    config.timeout = ms
  }
}

/**
 * Appends interceptors to the client interceptor chain.
 *
 * @param interceptors - Interceptors applied in registration order.
 * @returns An option that pushes onto `config.interceptors`.
 */
export function withInterceptors(...interceptors: Interceptor[]): ClientOption {
  return (config) => {
    config.interceptors.push(...interceptors)
  }
}

/**
 * Sets the query serializer for HTTP, SSE, and WebSocket requests.
 *
 * The function receives the encoded wire object and its string is used verbatim.
 * Without this option, queries use `URLSearchParams`: arrays repeat keys and a nested
 * object fails. A builder that returns `URLSearchParams` skips this serializer.
 *
 * @param serializer - Function that turns an encoded query object into a string.
 * @returns An option that sets `config.querySerializer`.
 */
export function withQuerySerializer(serializer: QuerySerializer): ClientOption {
  return (config) => {
    config.querySerializer = serializer
  }
}

/**
 * Overrides the Fetch-compatible function used for HTTP requests.
 *
 * @param fetchImpl - `(input, init?) => Promise<Response>`. Not `typeof fetch`, so
 *   a mock does not need host extras such as `preconnect`.
 * @returns An option that sets `config.http.handle`.
 */
export function withHTTPHandle(fetchImpl: FetchHandle): ClientOption {
  return (config) => {
    config.http.handle = fetchImpl
  }
}

/**
 * Overrides the Fetch-compatible function used for SSE connections.
 *
 * @param fetchImpl - `(input, init?) => Promise<Response>`. Not `typeof fetch`, so
 *   a mock does not need host extras such as `preconnect`.
 * @returns An option that sets `config.sse.handle`.
 */
export function withSSEHandle(fetchImpl: FetchHandle): ClientOption {
  return (config) => {
    config.sse.handle = fetchImpl
  }
}

/**
 * Overrides the WebSocket constructor used for socket connections.
 *
 * @param WebSocketImpl - Constructor that returns a `WebSocketHandle`.
 * @returns An option that sets `config.webSocket.handle`.
 */
export function withWebSocketHandle(WebSocketImpl: WebSocketHandleConstructor): ClientOption {
  return (config) => {
    config.webSocket.handle = WebSocketImpl
  }
}

/**
 * Runs logic before each WebSocket connect or reconnect attempt.
 *
 * @param beforeConnect - Hook receiving attempt index and abort signal.
 * @returns An option that sets `config.webSocket.beforeConnect`.
 */
export function withWebSocketBeforeConnect(beforeConnect: ClientWebSocketOptions['beforeConnect']): ClientOption {
  return (config) => {
    config.webSocket.beforeConnect = beforeConnect
  }
}

/**
 * Configure WebSocket subprotocols for the connection handshake.
 *
 * `protocols` are passed as the second argument to the `WebSocket` constructor
 * and participate in the RFC 6455 subprotocol negotiation. They are only
 * meaningful when the server requires a specific protocol (for example,
 * `['json']` or `['v1']` to select a message encoding version).
 *
 * @param protocols - Subprotocol list for the WebSocket constructor.
 * @returns An option that sets `config.webSocket.protocols`.
 */
export function withWebSocketProtocols(protocols: readonly string[]): ClientOption {
  return (config) => {
    config.webSocket.protocols = protocols
  }
}

/**
 * Enables WebSocket heartbeat pings and optional ACK detection.
 *
 * @param options - Heartbeat interval, payload, timeout, and ACK predicate.
 * @returns An option that sets `config.webSocket.heartbeat`.
 */
export function withWebSocketHeartbeat(options: ClientWebSocketOptions['heartbeat']): ClientOption {
  return (config) => {
    config.webSocket.heartbeat = options
  }
}

/**
 * Configures automatic WebSocket reconnection after unexpected closes.
 *
 * @param options - Retry budget, backoff, and `shouldReconnect` gate.
 * @returns An option that sets `config.webSocket.reconnect`.
 */
export function withWebSocketReconnect(options: ClientWebSocketOptions['reconnect']): ClientOption {
  return (config) => {
    config.webSocket.reconnect = options
  }
}

/**
 * Handles SSE events that lack a matching struct or fail validation.
 *
 * @param handler - Callback for invalid events; may throw or return a value.
 * @returns An option that sets `config.sse.onInvalidEvent`.
 */
export function withSSEOnInvalidEvent(handler: ClientSSEOptions['onInvalidEvent']): ClientOption {
  return (config) => {
    config.sse.onInvalidEvent = handler
  }
}

/**
 * Configures automatic SSE reconnection after stream failures.
 *
 * @param options - Retry budget, backoff, and `shouldReconnect` gate.
 * @returns An option that sets `config.sse.reconnect`.
 */
export function withSSEReconnect(options: ClientSSEOptions['reconnect']): ClientOption {
  return (config) => {
    config.sse.reconnect = options
  }
}

/**
 * Enables XSRF cookie-to-header token forwarding for HTTP requests.
 *
 * Defaults to cookie `XSRF-TOKEN` and header `X-XSRF-TOKEN` when names are omitted.
 *
 * @param options - Cookie/header names and optional token provider.
 * @returns An option that sets `config.xsrf`.
 */
export function withXSRF(options: HttpClientOptions['xsrf'] = {}): ClientOption {
  return (config) => {
    config.xsrf = {
      cookieName: options.cookieName ?? 'XSRF-TOKEN',
      headerName: options.headerName ?? 'X-XSRF-TOKEN',
      tokenProvider: options.tokenProvider,
    }
  }
}

/**
 * Sets whether HTTP/SSE requests should include credentials (cookies).
 *
 * @param value - When `true`, credentials are sent with cross-origin requests.
 * @returns An option that sets `config.withCredentials`.
 */
export function withCredentials(value: boolean): ClientOption {
  return (config) => {
    config.withCredentials = value
  }
}
