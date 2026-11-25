import type { FetchHandle, WebSocketHandle } from "../client/config";

/**
 * WebSocket instance handle returned by `createPortWebSocketHandle`, exposing mutable `binaryType`.
 *
 * Assignable to `@defjs/core`'s {@link WebSocketHandle}.
 *
 * @group port
 */
export interface PortWebSocketHandle extends WebSocketHandle {
  /** Data type used for incoming binary WebSocket messages (`"blob"` or `"arraybuffer"`). */
  binaryType: BinaryType;
}

/**
 * Constructor signature accepted by {@link PortHostOptions.WebSocket}.
 *
 * @group port
 */
export interface PortWebSocketConstructor {
  /** Standard `WebSocket.OPEN` constant (`1`). */
  readonly OPEN: number;
  new (url: string | URL, protocols?: string | string[]): WebSocketHandle;
}

/**
 * Constructor returned by `createPortWebSocketHandle`, directly constructable and assignable to `@defjs/core`'s `WebSocketHandleConstructor`.
 *
 * @group port
 */
export interface PortWebSocketHandleConstructor {
  /** Ready state `CONNECTING` constant (`0`). */
  readonly CONNECTING: 0;
  /** Ready state `OPEN` constant (`1`). */
  readonly OPEN: 1;
  /** Ready state `CLOSING` constant (`2`). */
  readonly CLOSING: 2;
  /** Ready state `CLOSED` constant (`3`). */
  readonly CLOSED: 3;
  new (url: string | URL, protocols?: string | string[]): PortWebSocketHandle;
}

/**
 * Encoding mode used for binary payloads over a multiplexed port.
 *
 * - `"structured"` transfers owned `ArrayBuffer` instances directly over `MessagePort` structured clone.
 * - `"json"` chunks binary payloads and Base64-encodes them into JSON-serializable objects, suitable for WebExtension `runtime.Port`.
 *
 * @group port
 */
export type PortWireMode = "structured" | "json";

/**
 * Listener invoked when an incoming wire frame arrives from the peer port.
 *
 * @group port
 */
export type PortMessageListener = (data: unknown) => void;

/**
 * Listener invoked when the underlying port disconnects.
 *
 * @group port
 */
export type PortDisconnectListener = () => void;

/**
 * Custom bidirectional port abstraction accepted by `withPortTransport` and `attachPortHost` alongside native `MessagePort`.
 *
 * Use this interface when adapting Worker bridges, Electron `MessagePortMain`, sandboxed iframes, or WebExtension ports (`fromWebExtPort`).
 *
 * @group port
 */
export interface PortEndpoint {
  /** Preferred wire mode for binary frames. Defaults to `"structured"` when omitted. */
  readonly mode?: PortWireMode;
  /** Sends a frame to the peer port. `transfer` is supplied only in `"structured"` mode. */
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  /** Subscribes to incoming messages and returns an unsubscribe function. */
  onMessage: (listener: PortMessageListener) => () => void;
  /** Subscribes to port disconnect events and returns an unsubscribe function. */
  onDisconnect?: (listener: PortDisconnectListener) => () => void;
  /** Ensures a lazily-connected or hibernated port is connected before starting a new channel. */
  ensureConnected?: () => void;
}

/**
 * Native `MessagePort` or custom {@link PortEndpoint} accepted by `@defjs/core/port`.
 *
 * @group port
 */
export type PortLike = MessagePort | PortEndpoint;

/**
 * Options shared by `withPortTransport`, `createPortHTTPHandle`, `createPortSSEHandle`, and `createPortWebSocketHandle`.
 *
 * @group port
 */
export interface PortClientOptions {
  /** Frame payload mode. Defaults to `port.mode ?? "structured"`. */
  readonly mode?: PortWireMode;
  /** Maximum byte size per chunked binary frame (`1` to `1048576`). Defaults to `262144` (256 KiB). */
  readonly chunkSize?: number;
  /** Initial flow-control credit window in response body chunks. Defaults to `8`. */
  readonly creditWindow?: number;
}

/**
 * Normalized outgoing request context passed to {@link PortHostOptions.allowRequest}.
 *
 * @group port
 */
export interface PortRequestCheckContext {
  /** Requested transport (`"http"` covers both HTTP and SSE requests). */
  readonly transport: "http" | "websocket";
  /** Parsed target URL, already verified to use an HTTP(S) or WS(S) scheme without embedded credentials. */
  readonly url: URL;
  /** HTTP method, or `"GET"` for WebSocket connections. */
  readonly method: string;
  /** Copied request headers for HTTP/SSE, or an empty `Headers` object for WebSocket. */
  readonly headers: Headers;
}

/**
 * Configuration passed to `attachPortHost`.
 *
 * Hosts fail closed (default-deny): supply at least one of non-empty `allowedOrigins`, `allowRequest`, or `allowAnyOrigin: true`.
 *
 * @group port
 */
export interface PortHostOptions {
  /** Allowed target origins such as `"https://api.example.com"`. An `http:` origin permits `http:` and `ws:`; `https:` permits `https:` and `wss:`; `ws:` permits `ws:`; `wss:` permits `wss:`. */
  readonly allowedOrigins?: readonly string[];
  /** Custom policy hook evaluated after scheme, credential, and `allowedOrigins` checks. Returning `false` or throwing denies the channel. */
  readonly allowRequest?: (
    context: PortRequestCheckContext,
  ) => boolean | Promise<boolean>;
  /** Explicitly allows any `http:`, `https:`, `ws:`, or `wss:` origin without credentials. Defaults to `false`. */
  readonly allowAnyOrigin?: boolean;
  /** Fetch implementation invoked by the host for HTTP and SSE requests. Defaults to `globalThis.fetch`. */
  readonly fetch?: FetchHandle;
  /** WebSocket constructor invoked by the host for WebSocket channels. Defaults to `globalThis.WebSocket`. */
  readonly WebSocket?: PortWebSocketConstructor;
  /** Frame payload mode. Defaults to `port.mode ?? "structured"`. */
  readonly mode?: PortWireMode;
  /** Maximum byte size per chunked binary frame (`1` to `1048576`). Defaults to `262144` (256 KiB). */
  readonly chunkSize?: number;
  /** Maximum buffered HTTP request body size in bytes accepted by the host. Defaults to `33554432` (32 MiB). */
  readonly maxRequestBodyBytes?: number;
}

/**
 * Handle returned by `attachPortHost` to tear down active channels and detach listeners.
 *
 * @group port
 */
export interface PortHostHandle {
  /** Aborts in-flight HTTP/SSE channels, closes open WebSockets, sends a `port.close` notification, and detaches port listeners. Safe to call repeatedly. */
  close: () => void;
  /** Disposable alias for {@link close}. */
  [Symbol.dispose]: () => void;
}
