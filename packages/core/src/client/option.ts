import type { Balancer } from "../balancer/balancer";
import type { Interceptor } from "../interceptor/interceptor";
import { snapshotHeartbeat, snapshotProtocols, snapshotRetry } from "./capture";
import type {
  ClientConfig,
  ClientSSEOptions,
  ClientWebSocketOptions,
  FetchHandle,
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
 * Enables retries for HTTP, SSE, and WebSocket, with backoff and an optional policy function.
 *
 * Retries are opt-in: without this option every call makes one attempt, and an HTTP call creates no retry budget. Calling it with no argument or `{}` enables the defaults: 3 retries after the first attempt, a 1000 ms delay that doubles per retry up to 30000 ms, and jitter of 0.2. The same options apply to every transport; see {@link RetryOptions} for the decision order after a failure and for what counts as a retryable failure on each one.
 *
 * - HTTP retries a method in `methods` when the attempt got no response, got a 502, 503, or 504, or ran out of `attemptTimeoutMs`. Each retry rebuilds the request, reruns the complete interceptor chain, and lets the balancer pick again from every endpoint, so a single endpoint is tried again after the delay. Local failures before Fetch starts are not retried. Retry eligibility checks every method actually sent by the attempt, after interceptor rewrites; with no transport invocation it uses the defined method. A `budget` limits how many retries the client can make.
 * - SSE retries a method in `methods` after a handshake network failure, a 502, 503, or 504 handshake, an attempt timeout, or a network error after the stream opened. Normal EOF ends the stream. The `retry:` field of the server replaces `delayMs`, and the next attempt sends `Last-Event-ID`. A successful handshake resets the count.
 * - WebSocket retries every close that `session.close()` did not request, including a connection that never opened and a heartbeat timeout. A successful `open` resets the count.
 * - A `ReadableStream` request body, a caller abort, a manual close, and fatal errors end the call without a retry and without calling `shouldRetry`.
 *
 * Callers that need a time limit without retries use `withRetry({ maxRetries: 0, attemptTimeoutMs })`. The signal of the caller covers all attempts and waits. A later `withRetry` replaces the policy as a whole, and passing `undefined` is the same as passing `{}`; pass `{ maxRetries: 0 }` to turn retries off after enabling them. The `methods` array and the `budget` record are copied when the option is applied. A request option `retry` replaces this policy for one call, except `budget`, which stays with the client.
 *
 * @param options - Retry policy; omitted or `undefined` behaves like `{}`.
 * @returns An option that writes `config.retry`.
 * @exampleFile examples/client/http-retry.ts#example
 * @group client
 * @see {@link RetryOptions}
 */
export function withRetry(options?: RetryOptions): ClientOption {
  return (config) => {
    config.retry = snapshotRetry(options === undefined ? {} : options);
  };
}

/**
 * Sets static default headers for HTTP and SSE requests built by this client.
 *
 * WebSocket connections do not use them. The `HeadersInit` is copied into a `Headers` object when the option is applied. A later call replaces the earlier headers instead of merging.
 *
 * Headers returned by a request builder replace a default of the same name. The first value for that name replaces the default, and later values of that name, from a `[name, value]` array or a `Headers` instance, are appended to it. A record value is one value: an array joins with a comma the JavaScript way. Other default names stay.
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
      config.interceptors.push(
        copyInterceptor<Interceptor["kind"]>(interceptor),
      );
    }
  };
}

type InterceptorFnByKind = {
  [K in Interceptor["kind"]]: Extract<Interceptor, { kind: K }>["fn"];
};

type InterceptorOfKind<K extends Interceptor["kind"]> = {
  [P in K]: { kind: P; fn: InterceptorFnByKind[P] };
}[K];

// Both fields come from the same discriminated-union member; the mapped type keeps them correlated.
function copyInterceptor<K extends Interceptor["kind"]>(
  interceptor: InterceptorOfKind<K>,
): InterceptorOfKind<K> {
  return { kind: interceptor.kind, fn: interceptor.fn };
}

/**
 * Replaces query encoding for HTTP, SSE, and WebSocket requests.
 *
 * `serializer(query)` receives the encoded wire object: aliases applied, `Date` as an ISO string, `bigint` as a string. Nested objects and arrays are kept as they are. It must return the query string without a leading `?`. The string is parsed into the request's `query`, so the request sends `query.toString()`, the URL Standard's application/x-www-form-urlencoded serialization: a space is `+`, `[` is `%5B`, and the bytes the function wrote are not kept.
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
 * Passing `undefined` clears an earlier setting. Defjs defines no heartbeat format: `message` and `isAck` are yours. The option type is {@link WebSocketHeartbeatConfig}:
 *
 * ```ts
 * {
 *   intervalMs: number
 *   message: () => unknown
 *   isAck?: (message: unknown) => boolean
 *   timeoutMs?: number // only together with isAck
 * }
 * ```
 *
 * - Every `intervalMs`, `message()` is called and its result is sent through the endpoint's `outgoing` struct as JSON text. No message is sent when it returns `undefined`.
 * - With `timeoutMs`, an acknowledgement is expected after each heartbeat; the type requires `isAck` then. `isAck` receives the decoded incoming message; when it returns `true`, the timer is cleared and that message is **not** delivered to `receive`.
 * - If no acknowledgement arrives within `timeoutMs`, the connection counts as failed: it is closed and the attempt enters the `withRetry` flow as a close that `session.close()` did not request. Without a retry policy the session ends with an `error` whose `cause` is the heartbeat timeout. A missing acknowledgement is reported to the balancer as `NET_UNREACHABLE`. A heartbeat that cannot be sent because `message()` throws or the value is not JSON is a local failure: it ends the session, is not retried, and is not attributed to the endpoint.
 * - A `heartbeat` in the request options replaces this one for that call.
 * - `intervalMs`, `isAck`, `message`, and `timeoutMs` are copied when this option is applied. `message` and `isAck` keep their identity. A getter runs at that moment and its exception escapes `createClient`.
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
