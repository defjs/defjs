import type { HttpProgressFn } from "../internal/http_request";
import type { ClientConfig, ClientWebSocketOptions } from "./config";
import { createClientConfig } from "./config";
import type { ClientOption } from "./option";

/**
 * Internal symbol key for a client's base configuration and derived request options.
 *
 * Application code calls the client and passes it to an operation. It does not read this property.
 *
 * @group client
 */
export const CLIENT = Symbol("Client");

/**
 * Flat per-call options. Each protocol reads the fields it understands and ignores the rest.
 *
 * SSE reads only `abort` from request options. SSE reconnect comes from client configuration (`withSSEReconnect`), so `client({ reconnect })` affects WebSocket only.
 *
 * `abort` cancels HTTP, SSE, and WebSocket calls. `onUploadProgress` and `onDownloadProgress` apply to HTTP. `beforeConnect`, `protocols`, `heartbeat`, and `reconnect` apply to WebSocket and replace the client setting for that call as a whole value. There is no `timeout` or `signal` field. Pass `AbortSignal.timeout(ms)` as `abort` when a call needs a deadline.
 *
 * @group client
 */
export type RequestOptions = {
  /** Aborts the call. An already aborted signal fails the call before transport. */
  abort?: AbortSignal;
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
};

// Slot value for [CLIENT]. Not exported from the package.
interface ClientState {
  readonly config: ClientConfig;
  readonly options: RequestOptions;
}

/**
 * Application client returned by `createClient`.
 *
 * Calling it returns a new client. The seven known fields are copied from the argument when `client(options)` is called, a top-level snapshot into a fresh options object overlaid on the current options. A later field wins. A field whose value is `undefined` is treated as not provided and keeps the parent's value. A derived client cannot drop a setting its parent has; to go back to no setting, derive again from the client that did not have it. Nested `heartbeat`, `protocols`, and `reconnect` values are kept by reference, not cloned. WebSocket reads them when the operation runs, copying heartbeat fields and the protocols list at that time, so mutating those objects after deriving can still affect a later call. Applications should treat them as immutable after passing them. The original client is not mutated. `client()`, `client(undefined)`, and `client({})` copy the current options. Deriving a client performs no I/O. A getter that throws does so from the call and is not returned as a fault.
 *
 * @group client
 * @see {@link createClient}
 * @see {@link RequestOptions}
 */
export interface Client {
  /** Returns a new client with `options` overlaid on this client's request options. */
  (options?: RequestOptions): Client;
  /** Internal state. Not part of the call surface. */
  readonly [CLIENT]: ClientState;
}

function overlay(base: RequestOptions, patch?: RequestOptions): RequestOptions {
  if (patch === undefined) {
    return { ...base };
  }
  return {
    abort: patch.abort ?? base.abort,
    onUploadProgress: patch.onUploadProgress ?? base.onUploadProgress,
    onDownloadProgress: patch.onDownloadProgress ?? base.onDownloadProgress,
    beforeConnect: patch.beforeConnect ?? base.beforeConnect,
    protocols: patch.protocols ?? base.protocols,
    heartbeat: patch.heartbeat ?? base.heartbeat,
    reconnect: patch.reconnect ?? base.reconnect,
  };
}

function createDerivedClient(
  config: ClientConfig,
  options: RequestOptions,
): Client {
  const state: ClientState = { config, options };
  function derive(patch?: RequestOptions): Client {
    return createDerivedClient(config, overlay(options, patch));
  }
  derive[CLIENT] = state;
  return derive;
}

/**
 * Creates a Defjs client from option helpers.
 *
 * Options apply in order: a later option overwrites an earlier one for the same setting, and interceptors accumulate. Prefer creating the client inside the request boundary when interceptors close over auth or tenants. Default HTTP/SSE fetch availability is checked when an operation invokes transport.
 *
 * The returned client is a function. Call it with {@link RequestOptions} to derive a client for one operation. The seven known fields are copied from that argument into a fresh options object. Nested `heartbeat`, `protocols`, and `reconnect` values are kept by reference. The base configuration is shared by every derived client and is not frozen at runtime. It is fixed by convention: nothing in the library changes it, and applications should not either. A getter that throws escapes the call; it is not converted into a fault.
 *
 * @param options - Client option helpers such as `withEndpoint`.
 * @returns A callable client that carries the resolved base configuration.
 *
 * @group client
 * @see {@link Client}
 * @see {@link ClientOption}
 * @see {@link RequestOptions}
 * @exampleFile examples/api/create-client.ts#example
 */
export function createClient(...options: ClientOption[]): Client {
  const config = createClientConfig();
  for (const option of options) {
    option(config);
  }
  return createDerivedClient(config, {});
}
