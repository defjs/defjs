import type { Balancer } from "../balancer/balancer";
import { pickFirstBalancer } from "../balancer/balancer";
import type { Interceptor } from "../interceptor/interceptor";
import type { HttpRequest } from "../http/http_request";
import type { WebSocketHeartbeatConfig } from "../web_socket/web_socket";

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
 * When an HTTP or SSE call through the client rejects with a value that is not a cancellation or timeout shape, the client reports `NET_UNREACHABLE`, whether the value is an `Error` or not. A call with a retry policy can then retry it. `fetchHandler` rejects with the value as is.
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
 * The transport sets `binaryType = 'arraybuffer'` when the property exists and ignores its absence. If the setter throws, it requests best-effort closure of the constructed handle before failing that attempt with `NET_UNREACHABLE`; the socket is not left outside cleanup. When the transport stops listening to a handle's `error` event, it leaves a no-op `error` listener that it never removes, so an implementation that throws for an `error` event without listeners (an `EventEmitter`-based one such as `ws` does when it is closed while connecting) cannot crash the process after the transport has detached its own listeners. This property is an optimization, and the decoder also accepts Blob frames. This is the instance type produced by a {@link WebSocketHandleConstructor}.
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
 * Optional WebSocket settings applied when creating a client: constructor, `beforeConnect` hook, heartbeat, and protocols.
 *
 * - **handle** — WebSocket constructor; defaults to `globalThis.WebSocket`.
 * - **beforeConnect** — Runs before each connect and reconnect attempt.
 * - **heartbeat** — Sends `message()` every `intervalMs`. With `timeoutMs` and `isAck`, a missing acknowledgement counts as a connection failure and reports `NET_UNREACHABLE` to the balancer. See {@link WebSocketHeartbeatConfig}.
 * - **protocols** — Subprotocols passed to the constructor.
 *
 * Set these with `withWebSocketHandle`, `withWebSocketBeforeConnect`, `withWebSocketHeartbeat`, and `withWebSocketProtocols`. `WebSocketExecuteOptions` can override `beforeConnect`, `heartbeat`, and `protocols` per call. Reconnection comes from the client's `retry` policy, set with `withRetry`; without one a close ends the session.
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
  /** Periodic heartbeat message and optional acknowledgement matching. */
  heartbeat?: WebSocketHeartbeatConfig;
  /** Subprotocols passed to the WebSocket constructor. */
  protocols?: readonly string[];
}

/**
 * Optional SSE settings applied when creating a client: fetch handle and invalid-event hook.
 *
 * - **handle** — Fetch implementation that opens the stream. The default resolves `globalThis.fetch` on each attempt, including replacements installed after import. Every SSE handle receives a `Request`. Missing global Fetch fails default execution with `ENV_UNSUPPORTED`; a custom handle remains usable.
 * - **onInvalidEvent** — Called when an event has no matching struct and no `default` struct (`'missing-struct'`), or its data fails validation (`'validation-failed'`). The event is skipped. An error thrown by the hook does not close the stream.
 *
 * Set these with `withSSEHandle` and `withSSEOnInvalidEvent`. Retries come from the client's `retry` policy, set with `withRetry`; without one a failed stream is not retried.
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

/** Fields shared by every {@link RetryContext}: the retry about to happen, its cause, and the default policy's verdict. */
interface RetryContextBase {
  /** Number of the retry about to start. The first retry is `1`. For SSE and WebSocket the count restarts at `1` after a connection is established again. */
  readonly attempt: number;
  /** The failure that ended the attempt: a fault, an error, or the cause a WebSocket close carries. It is `undefined` when a WebSocket closed without one. */
  readonly cause: unknown;
  /** What the default policy decides for this failure: the method is in `methods` and the failure is one the transport retries by default. `shouldRetry` can return it as is or override it. */
  readonly retryable: boolean;
}

/**
 * What `shouldRetry` receives after a failed HTTP attempt.
 *
 * `cause` is the fault the attempt returned. `status` is the response status when the attempt got a response. `retryable` is `true` for a method in `methods` and a failure without a response, a 502, 503, or 504 response, or an attempt timeout.
 *
 * @group client
 * @see {@link RetryOptions}
 */
export interface HttpRetryContext extends RetryContextBase {
  readonly transport: "http";
  /** Method the attempt sent. It is the last one when an interceptor sent more than one request. */
  readonly method: string;
  /** Endpoint the failed attempt used. */
  readonly endpoint: string;
  /** Status of the response, when the attempt got one. */
  readonly status?: number;
}

/**
 * What `shouldRetry` receives after an SSE handshake or stream failed.
 *
 * `cause` is the failure: an `HTTP_STATUS` fault for a non-2xx handshake, otherwise the error that ended the attempt. `retryable` is `true` for a method in `methods` and a handshake network failure, a 502, 503, or 504 handshake, an attempt timeout, or a network error after the stream opened. A normal end of the stream never retries.
 *
 * @group client
 * @see {@link RetryOptions}
 */
export interface SSERetryContext extends RetryContextBase {
  readonly transport: "sse";
  /** Method of the stream request. */
  readonly method: string;
  /** The last event ID the stream committed, or an empty string. The next attempt sends it as `Last-Event-ID`. */
  readonly lastEventId: string;
  /** The latest handshake response, when one arrived. */
  readonly open?: {
    readonly response: {
      readonly status: number;
      readonly statusText: string;
      readonly url: string;
    };
    readonly url: string;
  };
  /** Status of the handshake response, when one arrived. */
  readonly status?: number;
}

/**
 * What `shouldRetry` receives after a WebSocket closed without `session.close()`.
 *
 * `cause` is the connection error, or `undefined` for a clean close. `code`, `reason`, and `wasClean` come from the close event and are `undefined` when none was observed, for example after a heartbeat timeout or an attempt timeout. `retryable` is always `true`: a close the caller did not request is retried by default, including a connection that never opened.
 *
 * @group client
 * @see {@link RetryOptions}
 */
export interface WebSocketRetryContext extends RetryContextBase {
  readonly transport: "websocket";
  /** Close code, when a close event was observed. */
  readonly code?: number;
  /** Close reason, when a close event was observed. */
  readonly reason?: string;
  /** Whether the close was clean, when a close event was observed. */
  readonly wasClean?: boolean;
}

/**
 * Failure description passed to `shouldRetry`. Narrow it with `transport`.
 *
 * @group client
 * @see {@link RetryOptions}
 */
export type RetryContext =
  HttpRetryContext | SSERetryContext | WebSocketRetryContext;

/**
 * Opt-in retry policy for HTTP, SSE, and WebSocket.
 *
 * Call {@link withRetry}() or pass `{}` to enable retries with the defaults. Without a policy every call makes one attempt. Per call, `client({ retry })` replaces the client's policy as a whole value.
 *
 * After each failed attempt the policy decides in this order:
 *
 * 1. A caller abort, a manual `close()`, a fatal error such as a mismatched media type, a WebSocket whose constructor throws, and a `ReadableStream` request body end the call. `shouldRetry` is not called.
 * 2. When `maxRetries` retries have been made, the call ends. `shouldRetry` is not called.
 * 3. `shouldRetry(context)` decides. Without it, `context.retryable` does.
 * 4. HTTP only: a retry that the `budget` cannot pay for ends the call.
 * 5. The call waits for the backoff delay, then the balancer picks an endpoint again. Every endpoint is a candidate, including the one that just failed, so a single endpoint is tried again after the delay.
 *
 * @exampleFile examples/client/http-retry.ts#example
 * @group client
 * @see {@link withRetry}
 */
export interface RetryOptions {
  /** Retries after the first attempt. Defaults to 3; `0` never retries. For SSE and WebSocket the count restarts when a connection is established again. */
  readonly maxRetries?: number;
  /** Initial backoff delay in milliseconds. Defaults to 1000. Zero skips waiting. */
  readonly delayMs?: number;
  /** Multiplier applied to the delay for each further retry. Defaults to 2. The first retry waits `delayMs`. */
  readonly factor?: number;
  /** Cap on the final delay in milliseconds, jitter included. Defaults to 30000; `Infinity` removes the cap. The platform timer limit of `2_147_483_647` still applies. */
  readonly maxDelayMs?: number;
  /** Multiplicative jitter in [0, 1]. Defaults to 0.2, plus or minus twenty percent. */
  readonly jitter?: number;
  /**
   * Time limit for one attempt in milliseconds. Unset by default. HTTP counts from the call to the end of the response body, SSE to the response headers, WebSocket to `open`. An attempt that runs out is a failure that the policy handles like a connection failure.
   * Use `withRetry({ maxRetries: 0, attemptTimeoutMs })` for a time limit without retries.
   */
  readonly attemptTimeoutMs?: number;
  /** Methods the default policy retries, case-insensitive. Defaults to GET, HEAD, OPTIONS, TRACE, PUT, and DELETE. HTTP checks every method an attempt sent, after interceptor rewrites. WebSocket ignores it. */
  readonly methods?: readonly string[];
  /**
   * Decides whether a failed attempt is retried. It is called after the `maxRetries` check and replaces `context.retryable`; return it to keep the default. It may return a promise, which the caller's signal can cancel. A throw ends the call with `EXT_HOOK_FAILED` and the thrown value as `cause`; an open SSE stream reports that code in `closed.code`, and an open WebSocket session ends with `closed.kind: "error"` and the thrown value as `closed.cause`.
   */
  readonly shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
  /**
   * HTTP only. Client-owned Finagle retry budget; `false` removes the cap.
   * Derived clients sharing one configuration share its budget. Separate clients
   * keep independent budgets, even when they share a balancer. Credits and debits
   * expire lazily in ten TTL/10 slices (at most one slice early).
   * Defaults: 20% plus 10 retries/second of reserve over a 10000 ms TTL.
   */
  readonly budget?:
    | false
    | {
        /** Ratio of retries to calls, in [0, 1000]. Defaults to 0.2. Finagle integer token scaling (including Int cost saturation) applies. */
        readonly percentCanRetry?: number;
        /** Retries per second always allowed. Defaults to 10. */
        readonly minRetriesPerSecond?: number;
        /** Window in milliseconds over which credits and debits count. Defaults to 10000. */
        readonly ttlMs?: number;
      };
}

/**
 * Input-shaped client options, including SSE and WebSocket, that mirror what the option helpers configure.
 *
 * The user-facing shape of the settings before defaults are applied. `createClient` does not accept this object; configure a client with option helpers such as `withEndpoint`. {@link ClientConfig} is the resolved counterpart.
 *
 * @group client
 */
export interface ClientOptions {
  /**
   * Candidate base URLs. `withEndpoint` copies them and drops later duplicates.
   * An empty list is legal and fails at execution with `REQ_BUILD_FAILED`.
   */
  endpoints: readonly string[];
  /** Static default headers merged under headers returned by the builder for HTTP/SSE. */
  headers?: Headers;
  /** HTTP transport overrides; the default resolves global `fetch` on each call. */
  http?: { handle?: FetchHandle };
  /** Interceptors applied in registration order. */
  interceptors?: Interceptor[];
  /** Serializes encoded query objects. Omit to use `URLSearchParams`. */
  querySerializer?: QuerySerializer;
  /** When `true`, credentials are included with requests. */
  withCredentials?: boolean;
  /** Opt-in retry policy shared by HTTP, SSE, and WebSocket. */
  retry?: RetryOptions;
  /** SSE transport options. */
  sse?: ClientSSEOptions;
  /** WebSocket transport and heartbeat options. */
  webSocket?: ClientWebSocketOptions;
}

/**
 * Resolved client configuration after option helpers have been applied.
 *
 * The snapshot that `createClient` builds, that every option helper mutates, and that instances from `createClient` hold.
 *
 * Before any option applies, `endpoints` is `[]`, `balancer` is a new `pickFirstBalancer()`, `interceptors` is empty, `retry` is undefined (retries disabled), and `http.handle` and `sse.handle` share a default wrapper that resolves `globalThis.fetch` on each call. Replacing Fetch after import affects both defaults. Core can be imported without Fetch; a default HTTP/SSE execution fails with `ENV_UNSUPPORTED` if it is still missing. Custom handles do not require a global Fetch. `webSocket.handle` is `globalThis.WebSocket`, and the other `webSocket` settings are unset. `finalizeHeaders` stays unset; `@defjs/core/xsrf` assigns it for browser XSRF forwarding.
 *
 * @group client
 */
export interface ClientConfig {
  /**
   * Candidate base URLs in first-seen order. Empty until `withEndpoint` runs.
   * The balancer picks one per call.
   */
  endpoints: readonly string[];
  /** Static default headers merged under headers returned by the builder for HTTP/SSE. */
  headers?: Headers;
  /** HTTP transport with a required fetch handle. */
  http: { handle: FetchHandle };
  /** Interceptors applied in registration order. */
  interceptors: Interceptor[];
  /** Serializes encoded query objects. Omit to use `URLSearchParams`. */
  querySerializer?: QuerySerializer;
  /**
   * Called once per HTTP attempt. The hook receives the outgoing headers after interceptors and before the default `Accept` is filled in, plus the resolved URL.
   * A throw fails the call with `EXT_HOOK_FAILED`, with the thrown value as `cause`. It is not an endpoint attempt and is not retried. Stays unset until an option assigns it.
   */
  finalizeHeaders?: HttpRequest["finalizeHeaders"];
  /** When `true`, credentials are included with requests. */
  withCredentials?: boolean;
  /** Selects one candidate per call. Defaults to a fresh {@link pickFirstBalancer}. */
  balancer: Balancer;
  /** Retry policy shared by HTTP, SSE, and WebSocket. Unset means every call makes one attempt. */
  retry?: RetryOptions;
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

export function createClientConfig(): ClientConfig {
  return {
    endpoints: [],
    balancer: pickFirstBalancer(),
    retry: undefined,
    headers: undefined,
    http: { handle: DEFAULT_FETCH },
    interceptors: [],
    querySerializer: undefined,
    finalizeHeaders: undefined,
    withCredentials: undefined,
    sse: {
      handle: DEFAULT_FETCH,
      onInvalidEvent: undefined,
    },
    webSocket: {
      handle: globalThis.WebSocket,
      beforeConnect: undefined,
      heartbeat: undefined,
      protocols: undefined,
    },
  };
}
