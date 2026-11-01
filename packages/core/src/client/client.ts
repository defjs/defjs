import type { HttpProgressFn } from "../internal/http_request";
import type { ClientConfig, ClientWebSocketOptions } from "./config";
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
 * Client value that operations accept.
 *
 * A client value carries the base configuration and one call's request options. Operations accept it. It is not callable; create one by calling the factory returned by `createClient`. Calling a client value throws a `TypeError` at runtime and fails to compile.
 *
 * Create a client value per call. Reusing a value that carries `abort` shares that signal between calls.
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
 * A factory is a {@link Client} that carries no request options, so it can be passed to an operation directly. Calling it with {@link RequestOptions} returns a plain, non-callable `Client` value for one call and performs no I/O. That value cannot be called again: `client()()` fails to compile and throws a `TypeError` at runtime. The seven known fields are copied from the argument into a fresh options object, unknown fields are ignored, and fields whose value is `undefined` are omitted. Nested `heartbeat`, `protocols`, and `reconnect` values are kept by reference. There is no parent overlay: `client()`, `client(undefined)`, and `client({})` all return a client with no request options. A getter that throws escapes the call and is not converted into a fault; the factory stays usable.
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

const KNOWN_FIELDS = [
  "abort",
  "onUploadProgress",
  "onDownloadProgress",
  "beforeConnect",
  "protocols",
  "heartbeat",
  "reconnect",
] as const satisfies readonly (keyof RequestOptions)[];

function snapshot(patch?: RequestOptions): RequestOptions {
  const out: Record<string, unknown> = {};
  if (patch === undefined) {
    return out;
  }
  for (const key of KNOWN_FIELDS) {
    const value = patch[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function createClientValue(
  config: ClientConfig,
  options: RequestOptions,
): Client {
  return { [CLIENT]: { config, options } };
}

/**
 * Creates a Defjs {@link DerivableClient} from option helpers.
 *
 * Options apply in order: a later option overwrites an earlier one for the same setting, and interceptors accumulate. Prefer creating the client inside the request boundary when interceptors close over auth or tenants. Default HTTP/SSE fetch availability is checked when an operation invokes transport.
 *
 * The returned factory is a function. Calling it with {@link RequestOptions} returns a {@link Client} value for one call and performs no I/O; see {@link DerivableClient} for the snapshot rules. The factory itself is also a `Client` and carries no request options, so it can be passed to an operation directly. The base configuration is shared by every client value and is not frozen at runtime. It is fixed by convention: nothing in the library changes it, and applications should not either.
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
  function factory(patch?: RequestOptions): Client {
    return createClientValue(config, snapshot(patch));
  }
  factory[CLIENT] = { config, options: {} } satisfies ClientState;
  return factory;
}
