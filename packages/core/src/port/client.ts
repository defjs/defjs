import type { FetchHandle } from "../client/config";
import type { ClientOption } from "../client/option";
import {
  createPortFetch,
  normalizeClientOptions,
} from "./internal/http_client";
import { getPortMux } from "./internal/mux";
import { createPortWebSocketConstructor } from "./internal/ws_client";
import type {
  PortClientOptions,
  PortLike,
  PortWebSocketHandleConstructor,
} from "./types";

/**
 * Configures an application-owned `@defjs/core` client to route HTTP, SSE, and WebSocket operations over a multiplexed port.
 *
 * Sets `config.http.handle`, `config.sse.handle`, and `config.webSocket.handle`, sharing one underlying `PortMux` per port instance.
 *
 * @param port - Native `MessagePort` or custom `PortEndpoint`.
 * @param options - Wire framing mode, chunk size, and response backpressure credit window.
 * @returns A `ClientOption` for `createClient`.
 * @group port
 */
export function withPortTransport(
  port: PortLike,
  options?: PortClientOptions,
): ClientOption {
  const httpHandle = createPortHTTPHandle(port, options);
  const sseHandle = createPortSSEHandle(port, options);
  const wsHandle = createPortWebSocketHandle(port, options);

  return (config) => {
    config.http.handle = httpHandle;
    config.sse.handle = sseHandle;
    config.webSocket.handle = wsHandle;
  };
}

/**
 * Builds a `FetchHandle` that proxies HTTP requests across `port` using the shared multiplexer for that port.
 *
 * @param port - Native `MessagePort` or custom `PortEndpoint`.
 * @param options - Wire framing mode, chunk size, and response backpressure credit window.
 * @returns A `FetchHandle` accepted by `@defjs/core`'s `withHTTPHandle`.
 * @group port
 */
export function createPortHTTPHandle(
  port: PortLike,
  options?: PortClientOptions,
): FetchHandle {
  normalizeClientOptions(options);
  return createPortFetch(getPortMux(port), options);
}

/**
 * Builds a `FetchHandle` that proxies Server-Sent Events handshakes and chunked streams across `port` using the shared multiplexer for that port.
 *
 * @param port - Native `MessagePort` or custom `PortEndpoint`.
 * @param options - Wire framing mode, chunk size, and stream backpressure credit window.
 * @returns A `FetchHandle` accepted by `@defjs/core`'s `withSSEHandle`.
 * @group port
 */
export function createPortSSEHandle(
  port: PortLike,
  options?: PortClientOptions,
): FetchHandle {
  normalizeClientOptions(options);
  return createPortFetch(getPortMux(port), options);
}

/**
 * Builds a `WebSocketHandleConstructor` that proxies WebSocket sessions across `port` using the shared multiplexer for that port.
 *
 * @param port - Native `MessagePort` or custom `PortEndpoint`.
 * @param options - Wire framing mode and maximum binary chunk size.
 * @returns A `WebSocketHandleConstructor` accepted by `@defjs/core`'s `withWebSocketHandle`.
 * @group port
 */
export function createPortWebSocketHandle(
  port: PortLike,
  options?: PortClientOptions,
): PortWebSocketHandleConstructor {
  normalizeClientOptions(options);
  return createPortWebSocketConstructor(getPortMux(port), options);
}
