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
    /** Retries per outage; a successful open resets the budget. Non-negative safe integer; defaults to 3. `0` disables. */
    attempts?: number
    /** Initial backoff delay in milliseconds. */
    delayMs?: number
    /** Multiplier applied after each failed attempt of the current outage. A successful `open` resets the exponent. */
    factor?: number
    /** Random jitter factor applied to the delay (0–1). */
    jitter?: number
    /** Non-negative cap on the final backoff delay, including jitter; `Infinity` removes the configured cap. */
    maxDelayMs?: number
    /** Return `false` to skip reconnecting for this close. */
    shouldReconnect?: (context: { attempt: number; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }) => boolean
  }
}

/** Optional SSE settings applied when creating a client. */
export interface ClientSSEOptions {
  /** Fetch implementation used to open the event stream; defaults to resolving global `fetch` on each call. */
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
    /** Retries per outage; a successful handshake resets the budget. Non-negative safe integer; defaults to 3. `0` disables. */
    attempts?: number
    /** Initial backoff delay in milliseconds, finite and non-negative. Defaults to 1000. */
    delayMs?: number
    /** Finite positive multiplier per failed retry, reset after a successful handshake. Defaults to 1. */
    factor?: number
    /** Finite random jitter factor applied to the delay (0–1). Defaults to 0. */
    jitter?: number
    /** Non-negative cap on the final delay, including jitter; no configured cap when omitted or `Infinity`. */
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
  /** HTTP transport overrides; the default resolves global `fetch` on each call. */
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
export const PLATFORM_FETCH_HANDLE: FetchHandle | undefined = PLATFORM_FETCH?.bind(globalThis)
/** @internal Classified as ENV_UNSUPPORTED only when a transport reports it. */
export const ERR_FETCH_UNSUPPORTED = new Error('fetch is not supported in current runtime')

/**
 * Resolves global `fetch` on each call, including calls made by detached HTTP/SSE default handles.
 * HTTP recognizes it as the platform fast path only while the global fetch is untouched.
 */
export const DEFAULT_FETCH: FetchHandle = (input, init) => resolveGlobalFetch()(input, init)

/** The bound platform fast path while global fetch is untouched; a replaced global is an ordinary custom handle. */
export function resolveGlobalFetch(): FetchHandle {
  if (typeof globalThis.fetch !== 'function') {
    throw ERR_FETCH_UNSUPPORTED
  }
  return globalThis.fetch === PLATFORM_FETCH && PLATFORM_FETCH_HANDLE ? PLATFORM_FETCH_HANDLE : globalThis.fetch.bind(globalThis)
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
