import type { Interceptor } from '../interceptor/interceptor'
import type { HttpRequest } from '../internal/http_request'

/**
 * Serializes an encoded query object into a query string.
 *
 * `query` is the wire object: aliases already applied, `Date` values already ISO
 * strings, `bigint` values already strings. Nested objects and arrays are preserved.
 * The returned string is used verbatim and is not passed through `URLSearchParams`.
 *
 * @param query - Encoded query object.
 * @returns The query string without a leading `?`.
 */
export type QuerySerializer = (query: { [key: string]: unknown }) => string

/**
 * Fetch-compatible function used as an HTTP or SSE handle.
 *
 * This is the `(input, init?) => Promise<Response>` call signature Defjs invokes,
 * not `typeof fetch`, so mocks do not need host extras such as `preconnect`.
 */
export type FetchHandle = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Minimal WebSocket-like handle used by the client transport.
 *
 * Omits browser event-handler properties so custom implementations only need
 * the send/close/state surface Defjs relies on.
 */
export type WebSocketHandle = Omit<
  WebSocket,
  | 'binaryType'
  | 'CLOSED'
  | 'CLOSING'
  | 'CONNECTING'
  | 'dispatchEvent'
  | 'onclose'
  | 'onerror'
  | 'onmessage'
  | 'onopen'
  | 'OPEN'
  | 'readyState'
> & { readonly readyState: number }

/** Constructor for a `WebSocketHandle`, including the `OPEN` ready-state constant. */
export type WebSocketHandleConstructor = {
  readonly OPEN: number
} & (new (...args: never[]) => WebSocketHandle)

/** Optional WebSocket settings applied when creating a client. */
export interface ClientWebSocketOptions {
  /** WebSocket constructor; defaults to `globalThis.WebSocket`. */
  handle?: WebSocketHandleConstructor
  /** Hook before each connect/reconnect attempt. */
  beforeConnect?: (context: { attempt: number; signal: AbortSignal }) => void | Promise<void>
  /** Periodic heartbeat ping and optional ACK matching. */
  heartbeat?: {
    /** Delay between heartbeat messages. */
    intervalMs: number
    /** Returns whether an incoming message acknowledges the heartbeat. */
    isAck?: (message: unknown) => boolean
    /** Builds the outbound heartbeat payload. */
    message?: <T = unknown>() => T | unknown
    /** Time to wait for an ACK before treating the connection as unhealthy. */
    timeoutMs?: number
  }
  /** Subprotocols passed to the WebSocket constructor. */
  protocols?: readonly string[]
  /** Automatic reconnect policy after unexpected closes. */
  reconnect?: {
    /** Retry budget after the first connect. Defaults to 3 when `reconnect` is set. `0` disables. Omitting this field is not unlimited. */
    attempts?: number
    /** Initial backoff delay in milliseconds. */
    delayMs?: number
    /** Multiplier applied to the delay after each failed attempt. */
    factor?: number
    /** Random jitter factor applied to the delay (0–1). */
    jitter?: number
    /** Upper bound for computed backoff delay. */
    maxDelayMs?: number
    /** Return `false` to skip reconnecting for this close. */
    shouldReconnect?: (context: { attempt: number; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }) => boolean
  }
}

/** Optional SSE settings applied when creating a client. */
export interface ClientSSEOptions {
  /** Fetch implementation used to open the event stream. */
  handle?: FetchHandle
  /** Called when an event has no matching struct or fails validation. */
  onInvalidEvent?: (context: {
    reason: 'missing-struct' | 'validation-failed'
    message: { id: string; event: string; data: string }
    cause?: unknown
    signal: AbortSignal
  }) => unknown
  /** Automatic reconnect policy after stream failures. */
  reconnect?: {
    /** Retry budget after the first attempt. Defaults to 3 when `reconnect` is set. `0` disables. Omitting this field is not unlimited. */
    attempts?: number
    /** Initial backoff delay in milliseconds. */
    delayMs?: number
    /** Multiplier applied to the delay after each failed attempt. */
    factor?: number
    /** Random jitter factor applied to the delay (0–1). */
    jitter?: number
    /** Upper bound for computed backoff delay. */
    maxDelayMs?: number
    /**
     * Without this callback only `GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE` reconnect. With it, the result decides
     * for every method. It is never called for a `ReadableStream` body.
     */
    shouldReconnect?: (context: {
      attempt: number
      cause?: unknown
      lastEventId: string
      method: string
      open?: { response: { status: number; statusText: string; url: string }; url: string }
    }) => boolean | Promise<boolean>
  }
}

/** Resolved SSE config with a required `handle`. */
export interface ClientSSEConfig extends ClientSSEOptions {
  /** Fetch implementation used to open the event stream. */
  handle: FetchHandle
}

/** User-facing HTTP client options before defaults are applied. */
export interface HttpClientOptions {
  /** Base URL prepended to relative request paths. */
  endpoint: string
  /** Static default headers merged under command headers for HTTP/SSE. */
  headers?: Headers
  /** HTTP transport overrides. */
  http?: { handle?: FetchHandle }
  /** Interceptors applied in registration order. */
  interceptors?: Interceptor[]
  /** Serializes encoded query objects. Omit to use `URLSearchParams`. */
  querySerializer?: QuerySerializer
  /** Default HTTP execute timeout in milliseconds (SSE/WebSocket ignore this). */
  timeout?: number
  /** XSRF cookie/header mapping and optional token provider. */
  xsrf?: {
    /** Cookie name that stores the XSRF token. */
    cookieName?: string
    /** Request header name that receives the token. */
    headerName?: string
    /** Supplies a token instead of reading the cookie. */
    tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
  }
  /** When `true`, credentials are included with requests. */
  withCredentials?: boolean
}

/** User-facing options for `createClient`, including SSE and WebSocket. */
export interface ClientOptions extends HttpClientOptions {
  /** SSE transport and reconnect options. */
  sse?: ClientSSEOptions
  /** WebSocket transport, heartbeat, and reconnect options. */
  webSocket?: ClientWebSocketOptions
}

/** Resolved HTTP client config after defaults and options are applied. */
export interface HttpClientConfig {
  /** Base URL prepended to relative request paths. */
  endpoint: string
  /** Static default headers merged under command headers for HTTP/SSE. */
  headers?: Headers
  /** HTTP transport with a required fetch handle. */
  http: { handle: FetchHandle }
  /** Interceptors applied in registration order. */
  interceptors: Interceptor[]
  /** Serializes encoded query objects. Omit to use `URLSearchParams`. */
  querySerializer?: QuerySerializer
  /** Default HTTP execute timeout in milliseconds (SSE/WebSocket ignore this). */
  timeout?: number
  /** Resolved XSRF settings when enabled. */
  xsrf?: {
    /** Cookie name that stores the XSRF token. */
    cookieName: string
    /** Request header name that receives the token. */
    headerName: string
    /** Supplies a token instead of reading the cookie. */
    tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
  }
  /** When `true`, credentials are included with requests. */
  withCredentials?: boolean
}

/** Resolved client config held by instances from `createClient`. */
export interface ClientConfig extends HttpClientConfig {
  /** Resolved SSE configuration. */
  sse: ClientSSEConfig
  /** Resolved WebSocket configuration. */
  webSocket: ClientWebSocketOptions
}

const PLATFORM_FETCH = globalThis.fetch

/**
 * The library default handle. The HTTP transport recognizes it by identity: only it is the platform fetch called with the
 * request signal, so only it may be called as `(url, init)` and have its body read in one piece.
 */
export const DEFAULT_FETCH: FetchHandle = PLATFORM_FETCH.bind(globalThis)

/** `DEFAULT_FETCH` while the global fetch is untouched; a replaced global is an ordinary custom handle. */
export function resolveGlobalFetch(): FetchHandle {
  return globalThis.fetch === PLATFORM_FETCH ? DEFAULT_FETCH : globalThis.fetch.bind(globalThis)
}

export const DEFAULT_HTTP_OPTIONS: { handle: FetchHandle } = {
  handle: DEFAULT_FETCH,
}

export const DEFAULT_SSE_OPTIONS: ClientSSEConfig = {
  handle: DEFAULT_FETCH,
  onInvalidEvent: undefined,
  reconnect: undefined,
}

export function createHttpClientConfig(): HttpClientConfig {
  return {
    endpoint: '',
    http: { ...DEFAULT_HTTP_OPTIONS },
    interceptors: [],
    xsrf: undefined,
  }
}

export function createClientConfig(): ClientConfig {
  return {
    ...createHttpClientConfig(),
    sse: { ...DEFAULT_SSE_OPTIONS },
    webSocket: {
      handle: globalThis.WebSocket,
      beforeConnect: undefined,
      heartbeat: undefined,
      protocols: undefined,
      reconnect: undefined,
    },
  }
}
