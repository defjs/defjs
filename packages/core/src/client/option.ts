import type { Balancer } from "../balancer/balancer";
import type { Interceptor } from "../interceptor/interceptor";
import {
  snapshotHeartbeat,
  snapshotProtocols,
  snapshotReconnect,
  snapshotRetry,
} from "./capture";
import type {
  ClientConfig,
  ClientSSEOptions,
  ClientWebSocketOptions,
  FetchHandle,
  HttpClientOptions,
  QuerySerializer,
  RetryOptions,
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
 * Replaces the candidate base URLs prepended to relative request paths.
 *
 * The arguments are copied in order and later duplicates of the same string are
 * dropped. This does not validate URLs and does not change `balancer`.
 * A later `withEndpoint` replaces the list; it does not merge. Zero arguments
 * are legal and store `[]`. The default list is empty.
 *
 * The selected endpoint's pathname is kept as a directory; its query and hash are discarded. For WebSocket operations, an `http:` base becomes `ws:` and `https:` becomes `wss:`.
 *
 * A missing, relative, or invalid endpoint, or an illegal request path, fails with `REQ_BUILD_FAILED` during building, before any interceptor or transport runs, even when an interceptor would short-circuit. HTTP, SSE, and WebSocket share this rule. The resolved request must keep the base origin and stay under its directory; C0 control characters (including tab, CR, and LF), backslashes, `?`, `#`, and directory escapes in a path are rejected. Scheme-like and protocol-relative forms are rejected even with leading spaces; a plain inner space is allowed and sent as `%20`. An interceptor's final `req.endpoint` is checked against its final `req.baseEndpoint` with the same rule, but it may deliberately replace the base with another valid absolute URL. Deterministic URL errors are never retried.
 *
 * @param endpoints - Candidate base URLs. Invalid values fail when a call builds a request.
 * @returns An option that writes `config.endpoints`.
 * @group client
 */
export function withEndpoint(...endpoints: string[]): ClientOption {
  return (config) => {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const endpoint of endpoints) {
      if (!seen.has(endpoint)) {
        seen.add(endpoint);
        unique.push(endpoint);
      }
    }
    config.endpoints = unique;
  };
}

/**
 * Replaces the balancer that selects one candidate per call.
 *
 * The object is stored by reference and is not copied. A later
 * `withBalancer` replaces it. `withEndpoint` does not. Without this
 * option, each client gets its own `pickFirstBalancer()`.
 * This helper only stores the instance. HTTP retries are configured separately
 * with {@link withRetry}; the balancer knows nothing about retry policy.
 *
 * @param balancer - Balancer whose `pick` chooses one endpoint per call.
 * @returns An option that writes `config.balancer`.
 * @group client
 */
export function withBalancer(balancer: Balancer): ClientOption {
  return (config) => {
    config.balancer = balancer;
  };
}

/**
 * Configures opt-in same-call HTTP retries independently of endpoint balancing.
 *
 * Without this option HTTP tries once and creates no retry budget. Calling it
 * with no argument, `undefined`, or `{}` enables two total attempts for GET,
 * HEAD, OPTIONS, and TRACE connection failures.
 * Each retry rebuilds the request and reruns the complete interceptor chain,
 * selecting an untried endpoint. Streaming request bodies and offline failures
 * never retry. Local failures before Fetch starts are not connection failures.
 * Retry eligibility checks every method actually sent by the attempt, after
 * interceptor rewrites; with no transport invocation it uses the defined method.
 * A single configured endpoint is never replayed, because retries exclude every
 * endpoint already tried by this call.
 * SSE and WebSocket use their separate reconnect policies instead.
 *
 * Defaults are 25 ms delay, factor 2, 250 ms cap, and jitter 0.2. The caller's
 * signal covers all attempts and waits; `attemptTimeoutMs` covers each transport
 * attempt and must be finite, positive, and at most `2_147_483_647` ms.
 * Invalid policy values return `REQ_OPTIONS_INVALID` at HTTP execution.
 * Owned fields, arrays, and the budget record are captured when the option is
 * applied. A later option replaces the policy. `undefined` does not clear it;
 * pass `{ maxAttempts: 1 }` to turn retries off after enabling them.
 *
 * @param options - Retry policy; omitted or `undefined` behaves like `{}`.
 * @returns An option that writes `config.http.retry`.
 * @exampleFile examples/client/http-retry.ts#example
 * @group client
 * @see {@link RetryOptions}
 * @see {@link withSSEReconnect}
 * @see {@link withWebSocketReconnect}
 */
export function withRetry(options?: RetryOptions): ClientOption {
  return (config) => {
    config.http.retry = snapshotRetry(options === undefined ? {} : options);
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
 * Appends interceptors to the client interceptor chain.
 *
 * Calling it again appends more; it never replaces earlier ones. The first registered interceptor is the outermost layer. HTTP, SSE, and WebSocket interceptors can be mixed in one call. When an operation runs, only the interceptors of that transport run, in their registration order. Each `{ kind, fn }` record is copied when the option is applied. `fn` keeps its identity. Changing the original record later does not change clients already created.
 *
 * @param interceptors - Interceptors applied in registration order.
 * @returns An option that pushes onto `config.interceptors`.
 * @group client
 */
export function withInterceptors(...interceptors: Interceptor[]): ClientOption {
  return (config) => {
    for (const interceptor of interceptors) {
      // Both fields come from the same discriminated-union member.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve the original kind/fn snapshot for every runtime discriminator, including unknown kinds
      config.interceptors.push({
        kind: interceptor.kind,
        fn: interceptor.fn,
      } as Interceptor);
    }
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
 * The default is `globalThis.WebSocket`. `WebSocketImpl` is a {@link WebSocketHandleConstructor} that returns a {@link WebSocketHandle}. If no constructor is available, a WebSocket operation fails with an `ENV_UNSUPPORTED` fault.
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
 * - A `beforeConnect` in the request options replaces this one for that call.
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
 * Precedence, highest first: the `protocols` request option, this client option, then `protocols` on the endpoint definition. The array is copied when this option is applied, so a later edit of the original array does not retarget the client. Applying the same option to another client copies the array again.
 *
 * @param protocols - Subprotocol list for the WebSocket constructor.
 * @returns An option that sets `config.webSocket.protocols`.
 * @group client
 */
export function withWebSocketProtocols(
  protocols: readonly string[],
): ClientOption {
  return (config) => {
    config.webSocket.protocols = snapshotProtocols(protocols);
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
 * - If no ack arrives within `timeoutMs`, or a heartbeat cannot be sent, the session fails. This does not trigger a reconnect. A missing ack is reported to the balancer as `NET_UNREACHABLE`; a heartbeat that cannot be sent is a local failure and is not attributed to the endpoint.
 * - Heartbeat uses the same JSON guard as `session.send`: a value JSON cannot represent after struct encoding causes `TypeError` and ends the logical session.
 * - `intervalMs` and `timeoutMs` must be positive, finite, and at most `2_147_483_647`; otherwise the operation fails with `REQ_OPTIONS_INVALID`.
 * - A `heartbeat` in the request options replaces this one for that call.
 * - `intervalMs`, `isAck`, `message`, and `timeoutMs` are copied when this option is applied. `message` and `isAck` keep their identity. A missing value stays missing; `undefined` clears an earlier heartbeat. A getter runs at that moment and its exception escapes `createClient`. Numeric checks still run when the operation starts.
 *
 * @param options - Heartbeat interval, payload, timeout, and ACK predicate.
 * @returns An option that sets `config.webSocket.heartbeat`.
 * @group client
 */
export function withWebSocketHeartbeat(
  options: ClientWebSocketOptions["heartbeat"],
): ClientOption {
  return (config) => {
    config.webSocket.heartbeat = snapshotHeartbeat(options);
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
 *   connectTimeoutMs?: number
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
 * - `connectTimeoutMs` optionally bounds each handshake, is finite and positive, must not exceed `2_147_483_647` ms, and is cleared after response headers (SSE) or open (WebSocket). Expiry reports `NET_UNREACHABLE` to the balancer; exhausting reconnect attempts ends with `NET_TIMEOUT`.
 * - Reconnect options are validated before connecting: `attempts` must be a non-negative safe integer; `delayMs` must be finite and non-negative; `maxDelayMs` must be a non-negative finite number or positive `Infinity`, which removes the configured cap but not the platform limit of `2_147_483_647` ms; `factor` must be finite and positive; `jitter` must be finite and within 0–1. Invalid values make the operation fail with `REQ_OPTIONS_INVALID` before connecting. `attempts: 0` disables subsequent retries, but all explicitly supplied reconnect fields are still validated before the initial connection.
 * - A `reconnect` in the request options replaces this one for that call.
 * - `attempts`, `connectTimeoutMs`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, and `shouldReconnect` are copied when this option is applied. `shouldReconnect` keeps its identity and is not called. `undefined` clears an earlier policy. A getter runs at that moment and its exception escapes `createClient`. Invalid numbers still fail the operation with `REQ_OPTIONS_INVALID`.
 *
 * @param options - Retry budget, backoff, and `shouldReconnect` gate.
 * @returns An option that sets `config.webSocket.reconnect`.
 * @group client
 */
export function withWebSocketReconnect(
  options: ClientWebSocketOptions["reconnect"],
): ClientOption {
  return (config) => {
    config.webSocket.reconnect = snapshotReconnect(options);
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
 * - A handshake answered with 502, 503, or 504 is retried like a refused connection, under the same rules; other non-2xx handshakes are fatal. Exhausted retries end with `HTTP_STATUS`.
 * - `delayMs`, `factor`, `jitter` (0 to 1), and `maxDelayMs` shape the backoff. `factor` defaults to `1` and `jitter` to `0`. `maxDelayMs` caps the final delay after jitter and rounding. Without a configured cap, the platform timer limit of `2_147_483_647` ms still applies. A zero base stays zero; valid-number overflow saturates at the caps.
 * - `delayMs` is only the starting base delay (`1000` by default). A server `retry:` field (digits only, in milliseconds) replaces it for later attempts.
 * - An `id:` field updates a buffer. The reconnect cursor is committed only at the terminating blank line, even for an ID-only frame with no dispatched message; a stream ending before that blank line leaves it unchanged. The committed ID is sent as UTF-8 bytes in `Last-Event-ID` on the next attempt. An empty `id:` clears it at that blank line; an ID containing NUL is ignored.
 * - `connectTimeoutMs` optionally bounds each handshake, is finite and positive, must not exceed `2_147_483_647` ms, and is cleared after response headers (SSE) or open (WebSocket). Expiry reports `NET_UNREACHABLE` to the balancer; exhausting reconnect attempts ends with `NET_TIMEOUT`.
 * - Reconnect options are validated before interceptors or Fetch: `attempts` must be a non-negative safe integer; `delayMs` must be finite and non-negative; `maxDelayMs` must be a non-negative finite number or positive `Infinity`, which removes the configured cap but not the platform limit of `2_147_483_647` ms; `factor` must be finite and positive; `jitter` must be finite and within 0–1. Invalid values return `REQ_OPTIONS_INVALID` when the operation runs. The seven fields are copied when this option is applied, and `shouldReconnect` keeps its identity. `undefined` clears an earlier policy. A getter runs then, once, and its exception escapes `createClient`.
 *
 * @param options - Retry budget, backoff, and `shouldReconnect` gate.
 * @returns An option that sets `config.sse.reconnect`.
 * @group client
 */
export function withSSEReconnect(
  options: ClientSSEOptions["reconnect"],
): ClientOption {
  return (config) => {
    config.sse.reconnect = snapshotReconnect(options);
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
