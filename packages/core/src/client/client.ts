import type { HttpProgressFn } from "../internal/http_request";
import {
  snapshotHeartbeat,
  snapshotProtocols,
  snapshotReconnect,
  snapshotRetry,
} from "./capture";
import type {
  ClientConfig,
  ClientWebSocketOptions,
  RetryOptions,
} from "./config";
import { createClientConfig } from "./config";
import type { ClientOption } from "./option";

/**
 * Internal symbol key for a client's base configuration and request options.
 *
 * Application code passes the client to an operation. It does not call the client or read this property.
 *
 * @group client
 */
export const CLIENT = Symbol("Client");

/**
 * Flat per-call options. Each protocol reads the fields it understands and ignores the rest.
 *
 * SSE reads only `signal` from request options. SSE reconnect comes from client configuration (`withSSEReconnect`), so `client({ reconnect })` affects WebSocket only.
 *
 * `signal` cancels HTTP, SSE, and WebSocket calls. `onUploadProgress` and `onDownloadProgress` apply to HTTP. `beforeConnect`, `protocols`, `heartbeat`, and `reconnect` apply to WebSocket and replace the client setting for that call as a whole value. `client(options)` copies `heartbeat`, `reconnect`, and a `protocols` array at that call. Missing nested blocks stay missing. `signal`, `beforeConnect`, and callbacks keep their identity. There is no `timeout` or `abort` field. Pass `AbortSignal.timeout(ms)` as `signal` when a call needs a deadline.
 *
 * @group client
 */
export type RequestOptions = {
  /** Aborts the call. An already aborted signal fails the call before transport. */
  signal?: AbortSignal;
  /** Observes HTTP upload progress. */
  onUploadProgress?: HttpProgressFn;
  /** Observes HTTP download progress. */
  onDownloadProgress?: HttpProgressFn;
  /** Runs before each WebSocket connect attempt for this call. */
  beforeConnect?: ClientWebSocketOptions["beforeConnect"];
  /** WebSocket subprotocols for this call. Replaces the client list; it is not appended. */
  protocols?: readonly string[];
  /** WebSocket heartbeat for this call. Replaces the client heartbeat as a whole value. */
  heartbeat?: ClientWebSocketOptions["heartbeat"];
  /** WebSocket reconnect policy for this call. Replaces the client policy as a whole value. */
  reconnect?: ClientWebSocketOptions["reconnect"];
  /** Retry policy for this call. Replaces the client policy as a whole value; the `budget` stays with the client. */
  retry?: Omit<RetryOptions, "budget">;
};

// Slot value for [CLIENT]. Not exported from the package.
interface ClientState {
  readonly config: ClientConfig;
  readonly options?: RequestOptions;
}

/**
 * Client value that operations accept.
 *
 * A client value carries the base configuration and one call's request options. Operations accept it. It is not callable; create one by calling the factory returned by `createClient`. Calling a client value throws a `TypeError` at runtime and fails to compile.
 *
 * Create a client value per call. Reusing a value that carries `signal` shares that signal between calls.
 *
 * @group client
 * @see {@link createClient}
 * @see {@link RequestOptions}
 */
export interface Client {
  /** Internal state. Not part of the call surface. */
  readonly [CLIENT]: ClientState;
}

/**
 * Callable root client returned by `createClient`.
 *
 * A factory is a {@link Client} that carries no request options, so it can be passed to an operation directly. Calling it with {@link RequestOptions} returns a plain, non-callable `Client` value for one call and performs no I/O. That value cannot be called again: `client()()` fails to compile and throws a `TypeError` at runtime. `client()` and `client(undefined)` store no request options. `client({})` keeps the empty snapshot produced by reading each top-level field; it is not dropped by inspecting keys.
 *
 * Each provided field is read once, in declaration order, onto a new options object. A `protocols` array is copied. `heartbeat` copies `intervalMs`, `isAck`, `message`, and `timeoutMs`. `reconnect` copies `attempts`, `connectTimeoutMs`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, and `shouldReconnect`. Missing nested blocks stay `undefined` and do not enable heartbeat or retry. `signal`, `beforeConnect`, and every callback keep their identity. A getter on these fixed fields runs during the call. If it throws, the exception escapes and is not converted into a fault; the factory stays usable. Out-of-range numbers are still checked when the operation runs.
 *
 * @group client
 * @see {@link createClient}
 * @see {@link Client}
 * @see {@link RequestOptions}
 */
export interface DerivableClient extends Client {
  /** Returns a client value that carries `options` for one call. */
  (options?: RequestOptions): Client;
}

function snapshot(options?: RequestOptions): RequestOptions | undefined {
  if (options === undefined) {
    return undefined;
  }
  return {
    signal: options.signal,
    onUploadProgress: options.onUploadProgress,
    onDownloadProgress: options.onDownloadProgress,
    beforeConnect: options.beforeConnect,
    protocols: snapshotProtocols(options.protocols),
    heartbeat: snapshotHeartbeat(options.heartbeat),
    reconnect: snapshotReconnect(options.reconnect),
    retry: snapshotRetry(options.retry),
  };
}

function createClientValue(
  config: ClientConfig,
  options: RequestOptions | undefined,
): Client {
  return { [CLIENT]: { config, options } };
}

/**
 * Creates a Defjs {@link DerivableClient} from option helpers.
 *
 * Options apply in order: a later option overwrites an earlier one for the same setting, and interceptors accumulate. Prefer creating the client inside the request boundary when interceptors close over auth or tenants. Balancer state (sticky endpoint, ejections, load) and the retry budget belong to the client, so a client created per request starts them fresh. Creating the client once and deriving per-call values keeps both; passing one shared balancer to `withBalancer` keeps the balancer state only. Default HTTP/SSE fetch availability is checked when an operation invokes transport.
 *
 * The returned factory is a function. Calling it with {@link RequestOptions} returns a {@link Client} value for one call and performs no I/O; see {@link DerivableClient} for how request fields are captured. The factory itself is also a `Client` and carries no request options, so it can be passed to an operation directly. The base configuration is shared by every client value and is not frozen at runtime. It is fixed by convention: nothing in the library changes it, and applications should not either. Standard option helpers copy the fixed records they own when they are applied. A custom {@link ClientOption} may still retain a reference.
 *
 * @param options - Client option helpers such as `withEndpoint`.
 * @returns A callable factory that carries the resolved base configuration.
 *
 * @group client
 * @see {@link DerivableClient}
 * @see {@link Client}
 * @see {@link ClientOption}
 * @see {@link RequestOptions}
 * @exampleFile examples/api/create-client.ts#example
 */
export function createClient(...options: ClientOption[]): DerivableClient {
  const config = createClientConfig();
  for (const option of options) {
    option(config);
  }
  function factory(options?: RequestOptions): Client {
    return createClientValue(config, snapshot(options));
  }
  factory[CLIENT] = { config } satisfies ClientState;
  return factory;
}
