import type { Interceptor } from "../interceptor/interceptor";
import { validateTransportTimeout } from "../internal/abort";
import type {
  ClientConfig,
  ClientSSEOptions,
  ClientWebSocketOptions,
  FetchHandle,
  HttpClientOptions,
  QuerySerializer,
  WebSocketHandleConstructor,
} from "./config";

/**
 * Function type of the option helpers accepted by `createClient`.
 *
 * Mutates the {@link ClientConfig} that `createClient` is building. Every `with*` helper returns one. `createClient` applies the options in order, so a later option overwrites an earlier one for the same setting, except `withInterceptors`, which appends.
 *
 * @group client
 * @see {@link ClientConfig}
 */
export type ClientOption = (config: ClientConfig) => void;

/**
 * Sets the valid absolute base URL prepended to relative request paths.
 *
 * The default is an empty string, so execution requires an explicit endpoint. Its pathname is kept as a directory; its query and hash are discarded. For WebSocket commands, an `http:` base becomes `ws:` and `https:` becomes `wss:`.
 *
 * A missing, relative, or invalid endpoint, or an illegal request path, fails with `REQ_BUILD_FAILED` during building, before any interceptor or transport runs, even when an interceptor would short-circuit. HTTP, SSE, and WebSocket share this rule. The resolved request must keep the base origin and stay under its directory; C0 control characters (including tab, CR, and LF), backslashes, `?`, `#`, and directory escapes in a path are rejected. Scheme-like and protocol-relative forms are rejected even with leading spaces; a plain inner space is allowed and sent as `%20`. An interceptor's final `req.endpoint` is checked against its final `req.baseEndpoint` with the same rule, but it may deliberately replace the base with another valid absolute URL. Deterministic URL errors are never retried.
 *
 * @param endpoint - Absolute base endpoint. Missing or invalid endpoints fail request building.
 * @returns An option that writes `config.endpoint`.
 * @group client
 */
export function withEndpoint(endpoint: string): ClientOption {
  return (config) => {
    config.endpoint = endpoint;
  };
}

/**
 * Sets static default headers for HTTP and SSE requests built by this client.
 *
 * WebSocket connections do not use them. The `HeadersInit` is copied into a `Headers` object when the option is applied. A later call replaces the earlier headers instead of merging.
 *
 * Headers returned by a request builder replace a default of the same name. The first value for that name replaces the default; later values in the same array append only to that replacement. A scalar or a `Headers` instance also replaces. Other default names stay.
 *
 * Per-request or computed credentials, such as a refreshed Bearer token or an HMAC signature, belong in an interceptor, because they need the serialized body or a refreshed credential.
 *
 * @param headers - `HeadersInit` bag cloned onto the client config.
 * @returns An option that writes `config.headers`.
 * @group client
 */
export function withHeaders(headers: HeadersInit): ClientOption {
  return (config) => {
    config.headers = new Headers(headers);
  };
}

/**
 * Sets the default timeout, in milliseconds, for HTTP `execute` only.
 *
 * SSE and WebSocket ignore it. `ms` must be a positive safe integer no greater than `2_147_483_647`. Anything else throws `RangeError` immediately, when `withTimeout` is called, not when the client executes.
 *
 * The timer starts before the interceptor chain runs. When it fires, the call returns a `NET_TIMEOUT` fault. Execute `{ timeout }` replaces this default for that call. Execute `{ abort }` combines with the default: an abort gives `NET_ABORTED`, the timer gives `NET_TIMEOUT`. Passing both `abort` and `timeout` to the same `execute` call is still rejected.
 *
 * @param ms - Positive safe integer timeout in milliseconds.
 * @returns An option that writes `config.timeout`.
 * @group client
 */
export function withTimeout(ms: number): ClientOption {
  validateTransportTimeout(ms);
  return (config) => {
    config.timeout = ms;
  };
}

/**
 * Appends interceptors to the client interceptor chain.
 *
 * Calling it again appends more; it never replaces earlier ones. The first registered interceptor is the outermost layer. HTTP, SSE, and WebSocket interceptors can be mixed in one call. At execute time only the interceptors of the command's transport run, in their registration order.
 *
 * @param interceptors - Interceptors applied in registration order.
 * @returns An option that pushes onto `config.interceptors`.
 * @group client
 */
export function withInterceptors(...interceptors: Interceptor[]): ClientOption {
  return (config) => {
    config.interceptors.push(...interceptors);
  };
}

/**
 * Replaces query encoding for HTTP, SSE, and WebSocket requests.
 *
 * `serializer(query)` receives the encoded wire object: aliases applied, `Date` as an ISO string, `bigint` as a string. Nested objects and arrays are kept as they are. It must return the query string without a leading `?`. The string is used verbatim.
 *
 * It is not called when the request has no query. A builder that returns `URLSearchParams` skips it. Without this option, queries use `URLSearchParams`: arrays repeat keys and a nested object fails.
 *
 * @param serializer - Function that turns an encoded query object into a string.
 * @returns An option that sets `config.querySerializer`.
 * @group client
 */
export function withQuerySerializer(serializer: QuerySerializer): ClientOption {
  return (config) => {
    config.querySerializer = serializer;
  };
}

/**
 * Replaces the Fetch-compatible function used for HTTP requests.
 *
 * The default is the platform `fetch`. `fetchImpl` is a {@link FetchHandle}, so a test double does not need host extras such as `fetch.preconnect`. It only affects HTTP. SSE uses {@link withSSEHandle}.
 *
 * @param fetchImpl - `(input, init?) => Promise<Response>`. Not `typeof fetch`, so
 *   a mock does not need host extras such as `preconnect`.
 * @returns An option that sets `config.http.handle`.
 * @group client
 */
export function withHTTPHandle(fetchImpl: FetchHandle): ClientOption {
  return (config) => {
    config.http.handle = fetchImpl;
  };
}

/**
 * Replaces the Fetch-compatible function used to open SSE event streams.
 *
 * The default is the platform `fetch`. `fetchImpl` is a {@link FetchHandle}. It only affects SSE. HTTP uses {@link withHTTPHandle}.
 *
 * @param fetchImpl - `(input, init?) => Promise<Response>`. Not `typeof fetch`, so
 *   a mock does not need host extras such as `preconnect`.
 * @returns An option that sets `config.sse.handle`.
 * @group client
 */
export function withSSEHandle(fetchImpl: FetchHandle): ClientOption {
  return (config) => {
    config.sse.handle = fetchImpl;
  };
}

/**
 * Replaces the WebSocket constructor used for socket connections.
 *
 * The default is `globalThis.WebSocket`. `WebSocketImpl` is a {@link WebSocketHandleConstructor} that returns a {@link WebSocketHandle}. If no constructor is available, executing a WebSocket command fails with an `ENV_UNSUPPORTED` fault.
 *
 * @param WebSocketImpl - Constructor that returns a `WebSocketHandle`.
 * @returns An option that sets `config.webSocket.handle`.
 * @group client
 */
export function withWebSocketHandle(
  WebSocketImpl: WebSocketHandleConstructor,
): ClientOption {
  return (config) => {
    config.webSocket.handle = WebSocketImpl;
  };
}

/**
 * Runs a hook before the initial WebSocket connect and before every reconnect.
 *
 * The hook type is:
 *
 * ```ts
 * (context: { attempt: number; signal: AbortSignal }) => void | Promise<void>
 * ```
 *
 * - `attempt` is `0` for the first connect and grows by one for each reconnect.
 * - Pass `signal` into token refreshes and other async work so cancelling the session stops them.
 * - If the hook throws, the attempt fails with an `EXT_HOOK_FAILED` fault.
 * - A `beforeConnect` in the execute options replaces this one for that call.
 *
 * @param beforeConnect - Hook receiving attempt index and abort signal.
 * @returns An option that sets `config.webSocket.beforeConnect`.
 * @group client
 */
export function withWebSocketBeforeConnect(
  beforeConnect: ClientWebSocketOptions["beforeConnect"],
): ClientOption {
  return (config) => {
    config.webSocket.beforeConnect = beforeConnect;
  };
}

/**
 * Sets the WebSocket subprotocols offered during the handshake.
 *
 * They are passed as the second argument to the `WebSocket` constructor only when the list is not empty, so the platform can run the RFC 6455 subprotocol negotiation. They matter only when the server requires a specific subprotocol, for example `['json']` or `['v1']`.
 *
 * Precedence, highest first: the `protocols` execute option, this client option, then `protocols` on the endpoint definition.
 *
 * @param protocols - Subprotocol list for the WebSocket constructor.
 * @returns An option that sets `config.webSocket.protocols`.
 * @group client
 */
export function withWebSocketProtocols(
  protocols: readonly string[],
): ClientOption {
  return (config) => {
    config.webSocket.protocols = protocols;
  };
}

/**
 * Enables WebSocket heartbeat messages with optional acknowledgement detection.
 *
 * Passing `undefined` clears an earlier setting. The option type is:
 *
 * ```ts
 * {
 *   intervalMs: number
 *   isAck?: (message: unknown) => boolean
 *   message?: <T = unknown>() => T | unknown
 *   timeoutMs?: number
 * }
 * ```
 *
 * - Every `intervalMs`, `message()` is called and its result is sent through the endpoint's `outgoing` struct. No message is sent when `message` is omitted or returns `undefined`.
 * - With `timeoutMs`, an acknowledgement is expected after each heartbeat. `isAck` receives the decoded incoming message; when it returns `true`, the timer is cleared and that message is **not** delivered to `receive`.
 * - If no ack arrives within `timeoutMs`, or a heartbeat cannot be sent, the session fails. This does not trigger a reconnect.
 * - Heartbeat uses the same JSON guard as `session.send`: a value JSON cannot represent after struct encoding causes `TypeError` and ends the logical session.
 * - `intervalMs` and `timeoutMs` must be positive, finite, and at most `2_147_483_647`; otherwise execute fails with `REQ_OPTIONS_INVALID`.
 * - A `heartbeat` in the execute options replaces this one for that call.
 *
 * @param options - Heartbeat interval, payload, timeout, and ACK predicate.
 * @returns An option that sets `config.webSocket.heartbeat`.
 * @group client
 */
export function withWebSocketHeartbeat(
  options: ClientWebSocketOptions["heartbeat"],
): ClientOption {
  return (config) => {
    config.webSocket.heartbeat = options;
  };
}

/**
 * Configures automatic reconnection when the socket closes for any reason other than a manual `session.close()`.
 *
 * Reconnection is opt-in: without this option a close ends the session. Passing `undefined` clears an earlier setting. The option type is:
 *
 * ```ts
 * {
 *   attempts?: number
 *   delayMs?: number
 *   factor?: number
 *   jitter?: number
 *   maxDelayMs?: number
 *   shouldReconnect?: (context: { attempt: number; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }) => boolean
 * }
 * ```
 *
 * - `attempts` is the retry budget for each outage. It defaults to `3`, and `0` disables reconnection. Successful `open` resets the budget and backoff exponent; the next outage starts at retry 1. Omitting it does not give unlimited retries within one outage. A socket that successfully opens and is immediately closed again by the server can keep reconnecting at the base delay (subject to jitter and caps), because every open resets the budget; use `shouldReconnect` to stop it.
 * - `delayMs` defaults to `1000`, `factor` to `2`, `maxDelayMs` to `30000`, and `jitter` (0 to 1) to `0`. Retry _n_ starts with `delayMs * factor^(n-1)`, capped at `maxDelayMs`; jitter and rounding follow, then the final delay is capped again at `maxDelayMs` and `2_147_483_647` ms. A zero base stays zero; valid-number overflow saturates at those caps.
 * - `shouldReconnect` can return `false` to end the session instead. Without it every close is retried while the budget lasts. It is not called for a manual `session.close()`.
 * - Reconnect options are validated before connecting: `attempts` must be a non-negative safe integer; `delayMs` must be finite and non-negative; `maxDelayMs` must be a non-negative finite number or positive `Infinity`, which removes the configured cap but not the platform limit of `2_147_483_647` ms; `factor` must be finite and positive; `jitter` must be finite and within 0–1. Invalid values make execute fail with `REQ_OPTIONS_INVALID` before connecting. `attempts: 0` disables subsequent retries, but all explicitly supplied reconnect fields are still validated before the initial connection.
 * - A `reconnect` in the execute options replaces this one for that call.
 *
 * @param options - Retry budget, backoff, and `shouldReconnect` gate.
 * @returns An option that sets `config.webSocket.reconnect`.
 * @group client
 */
export function withWebSocketReconnect(
  options: ClientWebSocketOptions["reconnect"],
): ClientOption {
  return (config) => {
    config.webSocket.reconnect = options;
  };
}

/**
 * Observes SSE events that have no matching event struct or fail validation.
 *
 * The handler may be async and is awaited. The callback receives:
 *
 * ```ts
 * {
 *   reason: 'missing-struct' | 'validation-failed'
 *   message: { id: string; event: string; data: string }
 *   cause?: unknown
 *   signal: AbortSignal
 * }
 * ```
 *
 * - The invalid event is **always dropped**; it is never delivered to the stream. The callback only observes it.
 * - The return value is ignored. An error thrown by the callback is swallowed and does not close the stream, unless `signal` has already aborted.
 * - `cause` is set for `validation-failed`. Without a handler the invalid event is dropped silently.
 *
 * @param handler - Observer callback for invalid events.
 * @returns An option that sets `config.sse.onInvalidEvent`.
 * @group client
 */
export function withSSEOnInvalidEvent(
  handler: ClientSSEOptions["onInvalidEvent"],
): ClientOption {
  return (config) => {
    config.sse.onInvalidEvent = handler;
  };
}

/**
 * Configures automatic reconnection after an SSE stream fails.
 *
 * Reconnection is opt-in: without this option a failed stream is not retried. Passing `undefined` clears an earlier setting.
 *
 * ```ts
 * type SSEReconnect = {
 *   attempts?: number;
 *   delayMs?: number;
 *   factor?: number;
 *   jitter?: number;
 *   maxDelayMs?: number;
 *   shouldReconnect?: (context: {
 *     attempt: number;
 *     cause?: unknown;
 *     lastEventId: string;
 *     method: string;
 *     open?: {
 *       response: { status: number; statusText: string; url: string };
 *       url: string;
 *     };
 *   }) => boolean | Promise<boolean>;
 * };
 * ```
 *
 * - `attempts` is the retry budget for each outage. It defaults to `3` when `reconnect` is set, and `0` disables retries. A successful handshake resets the budget, callback `attempt`, and backoff exponent. Omitting it does not give unlimited retries within one outage. Repeated successful opens followed immediately by retryable stream failures can keep reconnecting at the current base delay (subject to jitter and caps), because each open resets the budget; use `shouldReconnect` to stop them. Normal EOF remains terminal.
 * - Without `shouldReconnect`, only `GET`, `HEAD`, `OPTIONS`, `PUT`, and `DELETE` reconnect. With it, its result decides for every method, `POST` included; `method` in the context tells endpoints apart. Return `false` to stop for this failure. It runs before the attempts limit is checked.
 * - A request with a `ReadableStream` body never reconnects, and `shouldReconnect` is not called for it.
 * - `delayMs`, `factor`, `jitter` (0 to 1), and `maxDelayMs` shape the backoff. `factor` defaults to `1` and `jitter` to `0`. `maxDelayMs` caps the final delay after jitter and rounding. Without a configured cap, the platform timer limit of `2_147_483_647` ms still applies. A zero base stays zero; valid-number overflow saturates at the caps.
 * - `delayMs` is only the starting base delay (`1000` by default). A server `retry:` field (digits only, in milliseconds) replaces it for later attempts.
 * - The last event id is sent again as UTF-8 bytes in `Last-Event-ID` on the next attempt. An empty `id:` clears it; an ID containing NUL is ignored.
 * - Reconnect options are validated before interceptors or Fetch: `attempts` must be a non-negative safe integer; `delayMs` must be finite and non-negative; `maxDelayMs` must be a non-negative finite number or positive `Infinity`, which removes the configured cap but not the platform limit of `2_147_483_647` ms; `factor` must be finite and positive; `jitter` must be finite and within 0–1. Invalid values return `REQ_OPTIONS_INVALID` at execute time.
 *
 * @param options - Retry budget, backoff, and `shouldReconnect` gate.
 * @returns An option that sets `config.sse.reconnect`.
 * @group client
 */
export function withSSEReconnect(
  options: ClientSSEOptions["reconnect"],
): ClientOption {
  return (config) => {
    config.sse.reconnect = options;
  };
}

/**
 * Enables XSRF cookie-to-header token forwarding for HTTP requests.
 *
 * SSE and WebSocket requests do not get the header. `cookieName` defaults to `XSRF-TOKEN` and `headerName` to `X-XSRF-TOKEN` when names are omitted.
 *
 * - The header is set only when all of these hold: the method is not `GET`, `HEAD`, `OPTIONS`, or `TRACE`; the request does not already have that header; the client has an endpoint; and, whenever `location` exists (Window or Worker), the resolved request URL has the same origin as `location.origin`. A cross-origin request does not call the provider.
 * - Without `tokenProvider`, the token is read from `document.cookie` and URL-decoded only when `document` exists. Workers and servers need a provider to supply a token.
 * - With `tokenProvider`, the cookie is never read. The provider receives the request, and its result is the token. An empty string, `null`, or `undefined` means no header.
 *
 * @param options - Cookie/header names and optional token provider.
 * @returns An option that sets `config.xsrf`.
 * @group client
 */
export function withXSRF(
  options: HttpClientOptions["xsrf"] = {},
): ClientOption {
  return (config) => {
    config.xsrf = {
      cookieName: options.cookieName ?? "XSRF-TOKEN",
      headerName: options.headerName ?? "X-XSRF-TOKEN",
      tokenProvider: options.tokenProvider,
    };
  };
}

/**
 * Sets whether HTTP and SSE requests include credentials.
 *
 * When `value` is `true`, Fetch uses `credentials: 'include'`, so cookies and other credentials are sent with cross-origin requests. When it is `false` or never set, `credentials` is left unset and Fetch uses its default. The WebSocket constructor does not receive this setting.
 *
 * @param value - When `true`, credentials are sent with cross-origin requests.
 * @returns An option that sets `config.withCredentials`.
 * @group client
 */
export function withCredentials(value: boolean): ClientOption {
  return (config) => {
    config.withCredentials = value;
  };
}
