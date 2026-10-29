import type { Interceptor } from "../interceptor/interceptor";
import type { HttpRequest } from "../internal/http_request";

/**
 * Serializes an encoded query object into a query string.
 *
 * `query` is the wire object: aliases already applied, `Date` values already ISO strings, `bigint` values already strings. Nested objects and arrays are preserved. The string is used verbatim and is not passed through `URLSearchParams`. Interceptors see `queryParams` as `new URLSearchParams(queryString)`.
 *
 * Set it with `withQuerySerializer`. Without one, queries use `URLSearchParams`: arrays repeat keys and a nested object fails. A builder that returns `URLSearchParams` skips the serializer.
 *
 * @param query - Encoded query object.
 * @returns The query string without a leading `?`.
 * @group client
 */
export type QuerySerializer = (query: { [key: string]: unknown }) => string;

/**
 * Fetch-compatible function used as an HTTP or SSE handle.
 *
 * This is the `(input, init?) => Promise<Response>` call signature Defjs invokes, deliberately not `typeof fetch`, so a mock does not need host extras such as `preconnect`. HTTP calls the untouched platform Fetch as `(url, init)`; a replaced global Fetch or custom handle receives a `Request`. The default resolves the global on each call. SSE always passes a `Request`, including to its default handle.
 *
 * Accepted by `withHTTPHandle`, `withSSEHandle`, and `fetchHandler`.
 *
 * @group client
 */
export type FetchHandle = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Minimal WebSocket instance surface used by the client transport.
 *
 * It is the DOM `WebSocket` without its event-handler properties, `binaryType`, `dispatchEvent`, and the state constants. A custom implementation therefore needs `url`, `protocol`, `extensions`, `bufferedAmount`, `send`, `close`, `addEventListener`, `removeEventListener`, and a numeric `readyState`.
 *
 * The transport sets `binaryType = 'arraybuffer'` when the property exists and ignores its absence. If the setter throws, it requests best-effort closure of the constructed handle before failing that attempt with `NET_UNREACHABLE`; the socket is not left outside cleanup. This property is an optimization, and the decoder also accepts Blob frames. This is the instance type produced by a {@link WebSocketHandleConstructor}.
 *
 * @group client
 */
export type WebSocketHandle = Omit<
  WebSocket,
  | "binaryType"
  | "CLOSED"
  | "CLOSING"
  | "CONNECTING"
  | "dispatchEvent"
  | "onclose"
  | "onerror"
  | "onmessage"
  | "onopen"
  | "OPEN"
  | "readyState"
> & { readonly readyState: number };

/**
 * Constructor type accepted by `withWebSocketHandle`.
 *
 * A class or function that builds a {@link WebSocketHandle} and exposes the numeric `OPEN` ready-state constant. The transport compares `readyState` with `OPEN`.
 *
 * It is called as `new WebSocketImpl(url)`, or `new WebSocketImpl(url, protocols)` when subprotocols are set. The default is `globalThis.WebSocket`.
 *
 * @group client
 */
export type WebSocketHandleConstructor = {
  readonly OPEN: number;
} & (new (...args: never[]) => WebSocketHandle);

/**
 * Optional WebSocket settings applied when creating a client: constructor, `beforeConnect` hook, heartbeat, protocols, and reconnect policy.
 *
 * - **handle** — WebSocket constructor; defaults to `globalThis.WebSocket`.
 * - **beforeConnect** — Runs before each connect and reconnect attempt.
 * - **heartbeat** — Sends `message()` every `intervalMs`. With `timeoutMs` and `isAck`, a missing acknowledgement marks the connection unhealthy. `intervalMs` and `timeoutMs` must be positive and at most 2147483647.
 * - **protocols** — Subprotocols passed to the constructor.
 * - **reconnect** — Opt-in. `attempts` defaults to **3**; `0` disables retry, and omitting `attempts` is not unlimited. Other defaults: `delayMs` 1000, `factor` 2, `jitter` 0 (a 0-1 multiplicative factor), `maxDelayMs` 30000. `shouldReconnect` receives the close `code`, `reason`, and `wasClean` and can veto a retry.
 *
 * The retry budget applies per outage. Successful `open` resets the budget, callback attempt, and backoff exponent; the next outage starts at retry 1. `maxDelayMs` caps the final delay after jitter and rounding, also bounded by `2_147_483_647` ms. See {@link withWebSocketReconnect} for validation rules and overflow behavior.
 *
 * Set these with `withWebSocketHandle`, `withWebSocketBeforeConnect`, `withWebSocketHeartbeat`, `withWebSocketProtocols`, and `withWebSocketReconnect`. `WebSocketExecuteOptions` can override `beforeConnect`, `heartbeat`, `protocols`, and `reconnect` per call.
 *
 * @group client
 */
export interface ClientWebSocketOptions {
  /** WebSocket constructor; defaults to `globalThis.WebSocket`. */
  handle?: WebSocketHandleConstructor;
  /** Hook before each connect/reconnect attempt. */
  beforeConnect?: (context: {
    attempt: number;
    signal: AbortSignal;
  }) => void | Promise<void>;
  /** Periodic heartbeat ping and optional ACK matching. */
  heartbeat?: {
    /** Delay between heartbeat messages. */
    intervalMs: number;
    /** Returns whether an incoming message acknowledges the heartbeat. */
    isAck?: (message: unknown) => boolean;
    /** Builds the outbound heartbeat payload. */
    message?: <T = unknown>() => T | unknown;
    /** Time to wait for an ACK before treating the connection as unhealthy. */
    timeoutMs?: number;
  };
  /** Subprotocols passed to the WebSocket constructor. */
  protocols?: readonly string[];
  /** Automatic reconnect policy after unexpected closes. */
  reconnect?: {
    /** Retries per outage; a successful open resets the budget. Non-negative safe integer; defaults to 3. `0` disables. */
    attempts?: number;
    /** Initial backoff delay in milliseconds. */
    delayMs?: number;
    /** Multiplier applied after each failed attempt of the current outage. A successful `open` resets the exponent. */
    factor?: number;
    /** Random jitter factor applied to the delay (0–1). */
    jitter?: number;
    /** Non-negative cap on the final backoff delay, including jitter; `Infinity` removes the configured cap. */
    maxDelayMs?: number;
    /** Return `false` to skip reconnecting for this close. */
    shouldReconnect?: (context: {
      attempt: number;
      cause?: unknown;
      code?: number;
      reason?: string;
      wasClean?: boolean;
    }) => boolean;
  };
}

/**
 * Optional SSE settings applied when creating a client: fetch handle, invalid-event hook, and reconnect policy.
 *
 * - **handle** — Fetch implementation that opens the stream. The default resolves `globalThis.fetch` on each attempt, including replacements installed after import. Every SSE handle receives a `Request`. Missing global Fetch fails default execution with `ENV_UNSUPPORTED`; a custom handle remains usable.
 * - **onInvalidEvent** — Called when an event has no matching struct and no `default` struct (`'missing-struct'`), or its data fails validation (`'validation-failed'`). The event is skipped. An error thrown by the hook does not close the stream.
 * - **reconnect** — Opt-in. Without it the stream never reconnects. `attempts` defaults to **3** per outage; `attempts: 0` disables retry. A successful handshake resets the budget, callback `attempt`, and backoff exponent. `delayMs` is the first base delay, 1000 by default, and a server-sent `retry:` value replaces it. `factor` defaults to 1. `jitter` is a 0–1 multiplicative factor and defaults to 0. `maxDelayMs` caps the final delay after jitter and rounding; without a configured cap, the platform limit of `2_147_483_647` ms still applies. A zero base stays zero; valid-number overflow saturates at the caps. Without `shouldReconnect` only `GET`, `HEAD`, `OPTIONS`, `PUT`, and `DELETE` reconnect; with it, its result decides for every method and its context carries `method`. A `ReadableStream` request body never reconnects. Reconnect sends the latest ID as UTF-8 bytes in `Last-Event-ID`; an empty ID clears it and an ID containing NUL is ignored.
 *
 * Reconnect options are validated before interceptors or Fetch: `attempts` is a non-negative safe integer; `delayMs` must be finite and non-negative; `maxDelayMs` must be a non-negative finite number or positive `Infinity`, which removes the configured cap but not the platform limit of `2_147_483_647` ms; `factor` is finite and positive; `jitter` is finite and within 0–1. Invalid values return `REQ_OPTIONS_INVALID` at execute time.
 *
 * Set these with `withSSEHandle`, `withSSEOnInvalidEvent`, and `withSSEReconnect`. Omitting `withSSEReconnect` disables retry.
 *
 * @group client
 */
export interface ClientSSEOptions {
  /** Fetch implementation used to open the event stream; defaults to resolving global `fetch` on each call. */
  handle?: FetchHandle;
  /** Called when an event has no matching struct or fails validation. */
  onInvalidEvent?: (context: {
    reason: "missing-struct" | "validation-failed";
    message: { id: string; event: string; data: string };
    cause?: unknown;
    signal: AbortSignal;
  }) => unknown;
  /** Automatic reconnect policy after stream failures. */
  reconnect?: {
    /** Retries per outage; a successful handshake resets the budget. Non-negative safe integer; defaults to 3. `0` disables. */
    attempts?: number;
    /** Initial backoff delay in milliseconds, finite and non-negative. Defaults to 1000. */
    delayMs?: number;
    /** Finite positive multiplier per failed retry, reset after a successful handshake. Defaults to 1. */
    factor?: number;
    /** Finite random jitter factor applied to the delay (0–1). Defaults to 0. */
    jitter?: number;
    /** Non-negative cap on the final delay, including jitter; no configured cap when omitted or `Infinity`. */
    maxDelayMs?: number;
    /**
     * Without this callback only `GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE` reconnect. With it, the result decides
     * for every method. It is never called for a `ReadableStream` body.
     */
    shouldReconnect?: (context: {
      attempt: number;
      cause?: unknown;
      lastEventId: string;
      method: string;
      open?: {
        response: { status: number; statusText: string; url: string };
        url: string;
      };
    }) => boolean | Promise<boolean>;
  };
}

/**
 * Resolved SSE configuration with a required fetch handle.
 *
 * The type of `ClientConfig.sse`. It is {@link ClientSSEOptions} with `handle` always present; the default wrapper resolves the current global `fetch` on each attempt, rather than capturing it at import time.
 *
 * @group client
 */
export interface ClientSSEConfig extends ClientSSEOptions {
  /** Fetch implementation used to open the event stream. */
  handle: FetchHandle;
}

/** User-facing HTTP client options before defaults are applied. */
export interface HttpClientOptions {
  /** Base URL prepended to relative request paths. */
  endpoint: string;
  /** Static default headers merged under command headers for HTTP/SSE. */
  headers?: Headers;
  /** HTTP transport overrides; the default resolves global `fetch` on each call. */
  http?: { handle?: FetchHandle };
  /** Interceptors applied in registration order. */
  interceptors?: Interceptor[];
  /** Serializes encoded query objects. Omit to use `URLSearchParams`. */
  querySerializer?: QuerySerializer;
  /** Default HTTP execute timeout in milliseconds (SSE/WebSocket ignore this). */
  timeout?: number;
  /** XSRF cookie/header mapping and optional token provider. */
  xsrf?: {
    /** Cookie name that stores the XSRF token. */
    cookieName?: string;
    /** Request header name that receives the token. */
    headerName?: string;
    /** Supplies a token instead of reading the cookie. */
    tokenProvider?: (context: {
      request: HttpRequest;
    }) => string | null | undefined;
  };
  /** When `true`, credentials are included with requests. */
  withCredentials?: boolean;
}

/**
 * Input-shaped client options, including SSE and WebSocket, that mirror what the option helpers configure.
 *
 * The user-facing shape of the settings before defaults are applied. `createClient` does not accept this object; configure a client with option helpers such as `withEndpoint` and `withTimeout`. {@link ClientConfig} is the resolved counterpart. The HTTP members come from the non-exported `HttpClientOptions` base and are shown inline.
 *
 * @group client
 */
export interface ClientOptions extends HttpClientOptions {
  /** SSE transport and reconnect options. */
  sse?: ClientSSEOptions;
  /** WebSocket transport, heartbeat, and reconnect options. */
  webSocket?: ClientWebSocketOptions;
}

/** Resolved HTTP client config after defaults and options are applied. */
export interface HttpClientConfig {
  /** Base URL prepended to relative request paths. */
  endpoint: string;
  /** Static default headers merged under command headers for HTTP/SSE. */
  headers?: Headers;
  /** HTTP transport with a required fetch handle. */
  http: { handle: FetchHandle };
  /** Interceptors applied in registration order. */
  interceptors: Interceptor[];
  /** Serializes encoded query objects. Omit to use `URLSearchParams`. */
  querySerializer?: QuerySerializer;
  /** Default HTTP execute timeout in milliseconds (SSE/WebSocket ignore this). */
  timeout?: number;
  /** Resolved XSRF settings when enabled. */
  xsrf?: {
    /** Cookie name that stores the XSRF token. */
    cookieName: string;
    /** Request header name that receives the token. */
    headerName: string;
    /** Supplies a token instead of reading the cookie. */
    tokenProvider?: (context: {
      request: HttpRequest;
    }) => string | null | undefined;
  };
  /** When `true`, credentials are included with requests. */
  withCredentials?: boolean;
}

/**
 * Resolved client configuration after option helpers have been applied.
 *
 * The snapshot that `createClient` builds, that every option helper mutates, and that instances from `createClient` hold. The HTTP members come from a non-exported `HttpClientConfig` base and are shown inline.
 *
 * Before any option applies, `endpoint` is `''`, `interceptors` is empty, and `http.handle` and `sse.handle` share a default wrapper that resolves `globalThis.fetch` on each call. Replacing Fetch after import affects both defaults. Core can be imported without Fetch; a default HTTP/SSE execution fails with `ENV_UNSUPPORTED` if it is still missing. Custom handles do not require a global Fetch. `webSocket.handle` is `globalThis.WebSocket`, and the other `webSocket` settings are unset. `withXSRF` fills `xsrf.cookieName` with `XSRF-TOKEN` and `xsrf.headerName` with `X-XSRF-TOKEN` when they are omitted.
 *
 * @group client
 */
export interface ClientConfig extends HttpClientConfig {
  /** Resolved SSE configuration. */
  sse: ClientSSEConfig;
  /** Resolved WebSocket configuration. */
  webSocket: ClientWebSocketOptions;
}

const PLATFORM_FETCH = globalThis.fetch;
export const PLATFORM_FETCH_HANDLE: FetchHandle | undefined =
  PLATFORM_FETCH?.bind(globalThis);
/** @internal Classified as ENV_UNSUPPORTED only when a transport reports it. */
export const ERR_FETCH_UNSUPPORTED = new Error(
  "fetch is not supported in current runtime",
);

/**
 * Resolves global `fetch` on each call, including calls made by detached HTTP/SSE default handles.
 * HTTP recognizes it as the platform fast path only while the global fetch is untouched.
 */
export const DEFAULT_FETCH: FetchHandle = (input, init) =>
  resolveGlobalFetch()(input, init);

/** The bound platform fast path while global fetch is untouched; a replaced global is an ordinary custom handle. */
export function resolveGlobalFetch(): FetchHandle {
  if (typeof globalThis.fetch !== "function") {
    throw ERR_FETCH_UNSUPPORTED;
  }
  return globalThis.fetch === PLATFORM_FETCH && PLATFORM_FETCH_HANDLE
    ? PLATFORM_FETCH_HANDLE
    : globalThis.fetch.bind(globalThis);
}

export const DEFAULT_HTTP_OPTIONS: { handle: FetchHandle } = {
  handle: DEFAULT_FETCH,
};

export const DEFAULT_SSE_OPTIONS: ClientSSEConfig = {
  handle: DEFAULT_FETCH,
  onInvalidEvent: undefined,
  reconnect: undefined,
};

export function createHttpClientConfig(): HttpClientConfig {
  return {
    endpoint: "",
    http: { ...DEFAULT_HTTP_OPTIONS },
    interceptors: [],
    xsrf: undefined,
  };
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
  };
}
