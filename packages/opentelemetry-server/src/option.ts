import type {
  ClientOption,
  EventStreamHandle,
  HttpRequest,
  HttpResponse,
  WebSocketSessionLike,
} from "@defjs/core";
import type {
  Attributes,
  Meter,
  Span,
  TextMapPropagator,
  Tracer,
} from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { createOpenTelemetryHttpInterceptor } from "./interceptor/http";
import { createOpenTelemetrySSEInterceptor } from "./interceptor/sse";
import { createOpenTelemetryWebSocketInterceptor } from "./interceptor/web_socket";
import {
  createHttpClientMetrics,
  createSSEClientMetrics,
  createWebSocketClientMetrics,
} from "./telemetry/metrics";

/**
 * Shared per-transport OpenTelemetry client options: whether the transport is enabled and its span hooks, generic over the response type.
 *
 * `TResponse` is what `responseHook` receives: `HttpResponse<unknown>` for HTTP, `EventStreamHandle<unknown>` for SSE, `WebSocketSessionLike` for WebSocket. See {@link OpenTelemetryServerHttpOptions}, {@link OpenTelemetryServerSSEOptions} and {@link OpenTelemetryServerWebSocketOptions}.
 *
 * `enabled` defaults to `true`; only `enabled: false` turns the transport off.
 *
 * Span hooks run only when a `tracer` is supplied. `startSpanHook` runs synchronously before span creation for its own transport. Its attributes are applied after built-in attributes, so the application may override `url.full` or another initial value. If it throws, Defjs creates the span with built-in attributes and continues the request. `requestHook` runs after span creation and before the request is sent; `responseHook` runs after the transport result is returned. Both may return a promise, but neither is awaited: a throw or rejection never blocks or fails the operation. `responseHook` receives the original request as its third argument.
 *
 * While `span.isRecording()` is true, hook failures record `defjs.otel.hook.error` and `exception` events. The `exception` event carries only `exception.type` (the class name, not a Defjs fault code), never `exception.message` or `exception.stacktrace`, because runtime error text can include the full request URL or a response body fragment; the same rule applies to the `exception` event recorded when a transport fails. For non-recording spans (ended or unsampled), failures go to the OpenTelemetry diagnostic logger through `diag.error`. Applications must configure `diag.setLogger(...)` from `@opentelemetry/api` to receive them; there is no automatic output by default. The package does not initialize the SDK, and this diagnostic is not a separate SDK `LogRecord`.
 *
 * Caller cancellation is not a failure, on every transport. An abort cause that is not a timeout (`ERR_ABORTED`, or an `AbortError`) leaves the span status unset, records no exception and no `error.type`, and adds the span event `http.aborted`, `sse.aborted` or `websocket.aborted`. The duration metrics are still recorded, without `error.type`; the connection metrics carry `defjs.result` `aborted`. No log is emitted. A timeout (`ERR_TIMEOUT`, or a `TimeoutError` such as the reason of `AbortSignal.timeout()`) stays a failure: the span ends `ERROR` and `error.type` is `timeout`. There is no `timeout` option; a deadline is `signal`.
 *
 * By default, `url.full` resolves only `request.endpoint` against optional `request.baseEndpoint`; `request.query` is not appended. That boundary is not query redaction. As the OpenTelemetry semantic conventions require, credentials in the endpoint's userinfo are replaced with `REDACTED:REDACTED`, and the values of the default sensitive query keys (`sig`, `Signature`, `AWSAccessKeyId`, `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Goog-Signature`) are replaced with `REDACTED`, but the package has no other built-in redactor or sensitive-key policy. A `url.full` returned by `startSpanHook` is redacted the same way, but a URL an application writes through the `Span` object in `requestHook` or `responseHook` is not intercepted, so construct and, if needed, redact it explicitly.
 *
 * Every span carries `http.request.method`, which is `GET` for the WebSocket handshake. A method outside RFC 9110, `PATCH` and `QUERY` is recorded as `_OTHER`, and a method that Fetch sends in upper case is recorded in upper case; `http.request.method_original` keeps the method as given when it differs.
 *
 * @group opentelemetry-server
 * @see {@link OpenTelemetryServerHttpOptions}
 * @see {@link OpenTelemetryServerSSEOptions}
 * @see {@link OpenTelemetryServerWebSocketOptions}
 * @exampleFile examples/api/opentelemetry-server-transport-options.ts#example
 */
export interface OpenTelemetryServerTransportOptions<TResponse> {
  /** Whether this transport's instrumentation is enabled. Defaults to `true`. */
  enabled?: boolean;
  /** Add application attributes when the client span is created. */
  startSpanHook?: (request: HttpRequest) => Attributes;
  /** Customize the client span before the request is sent. */
  requestHook?: (span: Span, req: HttpRequest) => Promise<void> | void;
  /** Customize the client span after the transport result is returned. */
  responseHook?: (
    span: Span,
    res: TResponse,
    req: HttpRequest,
  ) => Promise<void> | void;
}

/**
 * Options for the HTTP transport — the shared options with an HttpResponse in responseHook.
 *
 * Set on `http` in `OpenTelemetryServerOptions`. It has no fields of its own: `enabled`, `startSpanHook`, `requestHook` and `responseHook` come from `OpenTelemetryServerTransportOptions`.
 *
 * - `responseHook(span, res, req)` receives the `HttpResponse` that came back through the interceptor, before the client decodes a declared body, together with the original `HttpRequest`. Read `req.meta` for application-defined request metadata; Defjs never interprets it or adds it to telemetry.
 *
 * - The HTTP span ends as soon as `responseHook` returns; the hook is not awaited, so only its synchronous part can still change the span. A status of 400 or above ends it `ERROR` with `error.type` set to the status string; 100–399 leaves its status unset. An asynchronous hook rejection after end is reported through `diag.error`; configure `diag.setLogger(...)` from `@opentelemetry/api` to receive it. It cannot append events to an ended span.
 *
 * - A rejection through the interceptor has no response status and does not call `responseHook`. That includes a network failure, a timeout (`ERR_TIMEOUT`, or an abort whose reason is `TimeoutError`), caller cancellation, any declared-body read failure (`BodyFailure`, including text, blob, and bytes, not only JSON), a progress observer failure (`EXT_OBSERVER_FAILED`), and a request refused before it is sent (an invalid method, a URL with credentials, a header value the platform rejects, or a throwing `finalizeHeaders` hook), which carries the platform error or the hook's own error, not a library class. The span ends `ERROR` with `error.type` set to the thrown class name, such as `TypeError`, `Error` or `BodyFailure`, or to `timeout` for a timeout. Caller cancellation is the exception: the span records `http.aborted`, keeps its status unset and has no `error.type`, and the `http.client.request.duration` sample has none either.
 *
 * Pass `{ enabled: false }` to skip HTTP instrumentation. Span hooks run only when a `tracer` is supplied.
 *
 * @group opentelemetry-server
 * @see {@link OpenTelemetryServerTransportOptions}
 */
export type OpenTelemetryServerHttpOptions =
  OpenTelemetryServerTransportOptions<HttpResponse<unknown>>;
/**
 * Options for the SSE transport — the shared options with the stream handle in responseHook.
 *
 * Set on `sse` in `OpenTelemetryServerOptions`. It has no fields of its own: `enabled`, `startSpanHook`, `requestHook` and `responseHook` come from `OpenTelemetryServerTransportOptions`.
 *
 * - `responseHook(span, stream, req)` runs once the stream has opened, before the span records `sse.connected`. `stream` is the `EventStreamHandle` the transport returned; `req` is the original `HttpRequest`.
 *
 * - SSE is traced at connection level. After startup the span stays open until `stream.closed` settles, and records `sse.connected`, then one of `sse.closed` (server EOF), `sse.aborted` (`stream.close()`, or a caller abort of the open stream or of the handshake whose reason is not `TimeoutError`; the span ends with its status unset and the connection metrics carry `defjs.result` `aborted`), or `sse.error` (including an abort whose reason is `TimeoutError`, which ends the span `ERROR` with `error.type` `timeout`). No per-event spans are created. Reconnects happen inside the transport without rerunning interceptors, so `url.full`, `server.address` and `server.port` describe the first connection even when a reconnect picks another endpoint.
 *
 * - A non-2xx handshake is observed as a connection failure: the span ends `ERROR` and, with a `logger`, one `WARN` is emitted whatever the response body.
 *
 * Pass `{ enabled: false }` to skip SSE instrumentation. Span hooks run only when a `tracer` is supplied.
 *
 * @group opentelemetry-server
 * @see {@link OpenTelemetryServerTransportOptions}
 */
export type OpenTelemetryServerSSEOptions = OpenTelemetryServerTransportOptions<
  EventStreamHandle<unknown>
>;
/**
 * Options for the WebSocket transport — the shared options plus queryPropagation.
 *
 * Set on `webSocket` in `OpenTelemetryServerOptions`. `enabled`, `startSpanHook`, `requestHook` and `responseHook` come from `OpenTelemetryServerTransportOptions`; `responseHook(span, session, req)` receives the opened `WebSocketSessionLike` and the original `HttpRequest`.
 *
 * `queryPropagation` defaults to `false`: the WebSocket query string is left unchanged and no trace context or baggage is written into the URL. Browser WebSocket clients usually cannot set headers, so enabling it writes the propagated context to the end of the query string, replacing any parameter of the same name. Query strings can be recorded by proxies, access logs and APM tools, and baggage values can be sensitive. Turn it on only after you accept that exposure.
 *
 * WebSocket is traced at connection level. The span stays open until `session.closed` settles. It records `websocket.connected`, then `websocket.closed` for a normal close, `websocket.aborted` for a caller abort, or `websocket.error`. A close frame from the server counts as normal with any code, including 1011. An abrupt drop without a close frame (1006) ends the session in error and logs once, on every runtime. A caller abort, of an open session or while the WebSocket is still connecting, ends the span with its status unset and no log, and the connection metrics carry `defjs.result` `aborted`. When the abort reason is `TimeoutError`, it is a connection failure instead: the span ends `ERROR` with `error.type` `timeout`, one log is emitted, and an open session also records `websocket.error`. No per-message spans are created. The span carries `http.request.method` `GET`, the method of the opening handshake. `url.full` uses the `ws:` or `wss:` form of the connection URL. As with SSE, connection attributes describe the first connection; a reconnect to another endpoint does not change them.
 *
 * Pass `{ enabled: false }` to skip WebSocket instrumentation. Span hooks run only when a `tracer` is supplied.
 *
 * @group opentelemetry-server
 * @see {@link OpenTelemetryServerTransportOptions}
 */
export interface OpenTelemetryServerWebSocketOptions extends OpenTelemetryServerTransportOptions<WebSocketSessionLike> {
  /**
   * Inject trace context into the WebSocket URL query string.
   * Defaults to `false`; enable only after reviewing URL propagation exposure.
   */
  queryPropagation?: boolean;
}

/**
 * Options for {@link withOpenTelemetryServer}: tracer, meter, logger, propagator, and per-transport settings.
 *
 * Pass application-owned OpenTelemetry `Tracer`, `Meter`, and/or `Logger` handles.
 * This package does not initialize the OpenTelemetry SDK.
 *
 * - `tracer` — Optional. Without it there are no local spans and no span hooks.
 *
 * - `meter` — Optional. Without it no package metrics are recorded.
 *
 * - `logger` — Optional. A `Logger` from `@opentelemetry/api-logs`, not a Winston/Pino Logger. Without it no diagnostic LogRecords are emitted. Defjs never obtains a global logger or owns its provider.
 *
 * - `propagator` — Defaults to W3C Trace Context + Baggage.
 *
 * - `requireParentSpan` — Defaults to `false`. With a `tracer`, `true` bypasses all instrumentation, including logs, when no active parent span exists. Without a `tracer` it blocks neither metrics nor logs.
 *
 * - `http`, `sse`, `webSocket` — Per-transport options. Omitting a block leaves it unset and the transport enabled. A transport is disabled only by `{ enabled: false }`. `withOpenTelemetryServer` reads each present block once and copies its fields.
 *
 * @group opentelemetry-server
 * @see {@link OpenTelemetryServerHttpOptions}
 * @see {@link OpenTelemetryServerSSEOptions}
 * @see {@link OpenTelemetryServerWebSocketOptions}
 * @see {@link OpenTelemetryServerTransportOptions}
 */
export interface OpenTelemetryServerOptions {
  /** Optional tracer; omitting it disables outbound spans and span hooks. */
  tracer?: Tracer;
  /** Optional meter; when set, per-transport client metrics are recorded. */
  meter?: Meter;
  /** Optional logger; emits WARN diagnostics for failed outbound requests and connections. */
  logger?: Logger;
  /** Context propagator. Defaults to W3C Trace Context + Baggage. */
  propagator?: TextMapPropagator;
  /** With a tracer, bypass instrumentation when no active parent span exists. Ignored without a tracer. */
  requireParentSpan?: boolean;
  /** HTTP transport instrumentation options. */
  http?: OpenTelemetryServerHttpOptions;
  /** SSE transport instrumentation options. */
  sse?: OpenTelemetryServerSSEOptions;
  /** WebSocket transport instrumentation options. */
  webSocket?: OpenTelemetryServerWebSocketOptions;
}

/**
 * Client option that installs outbound OpenTelemetry interceptors for HTTP, SSE, and WebSocket.
 *
 * Appends one interceptor per enabled transport, in the order HTTP, SSE, WebSocket. Apply it at `createClient` time. It does not initialize the OpenTelemetry SDK or acquire global tracer, meter, or logger handles: pass the ones your application owns. Each transport can be toggled or customized via `http`, `sse`, and `webSocket`.
 *
 * `options` is required. It carries `tracer`, `meter`, `logger`, `propagator`, `requireParentSpan`, and the `http` / `sse` / `webSocket` transport options. Pass `{}` to install the interceptors with propagation only.
 *
 * Each of `tracer`, `meter` and `logger` is optional and works without the others. Without `tracer`, the plugin creates no local spans, never calls `trace.getTracer(...)`, and skips `startSpanHook`, `requestHook` and `responseHook`. Propagation still forwards the extracted parent context.
 *
 * HTTP, SSE, and WebSocket are on by default. Pass `{ enabled: false }` on a transport to skip it.
 *
 * `http`, `sse`, and `webSocket` are read once, in that order, during this call. A missing block stays missing. `tracer`, `meter`, `logger`, `propagator`, and hook functions keep their identity. Replacing a block, or changing its fields, after this call does not affect the returned option.
 *
 * `enabled` is read next. Only `enabled: false` disables a block, and that branch does not read its hooks or `queryPropagation`. Otherwise the copy continues with `startSpanHook`, `requestHook`, and `responseHook`; a WebSocket block then copies `queryPropagation`. Those getters run here, once. If a getter throws, the exception leaves this call immediately and later blocks are not read. It is not caught or deferred until the option is applied.
 *
 * The supplied Meter's instrument creation methods are called each time the returned option is applied to a client config, not during this call. The Meter/SDK controls instrument identity and aggregation. Each duration histogram receives its own copy of the default bucket boundaries.
 *
 * @param options - Required settings object. Each of `tracer`, `meter`, `logger`, and `propagator` may be omitted; pass `{}` for propagation only.
 * @returns A `ClientOption` for `createClient(...)`.
 *
 * @group opentelemetry-server
 * @see {@link ClientOption}
 * @see {@link OpenTelemetryServerOptions}
 * @exampleFile examples/api/with-opentelemetry-server.ts#example
 */
export function withOpenTelemetryServer(
  options: OpenTelemetryServerOptions,
): ClientOption {
  const {
    tracer,
    meter,
    logger,
    propagator = new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
    requireParentSpan = false,
  } = options;
  const shared = { tracer, logger, propagator, requireParentSpan };
  const http = snapshotTransport(options.http);
  const sse = snapshotTransport(options.sse);
  const webSocket = snapshotWebSocket(options.webSocket);

  return (config) => {
    if (http?.enabled !== false) {
      config.interceptors.push(
        createOpenTelemetryHttpInterceptor({
          ...http,
          ...shared,
          metrics: meter ? createHttpClientMetrics(meter) : undefined,
        }),
      );
    }

    if (sse?.enabled !== false) {
      config.interceptors.push(
        createOpenTelemetrySSEInterceptor({
          ...sse,
          ...shared,
          metrics: meter ? createSSEClientMetrics(meter) : undefined,
        }),
      );
    }

    if (webSocket?.enabled !== false) {
      config.interceptors.push(
        createOpenTelemetryWebSocketInterceptor({
          ...webSocket,
          ...shared,
          metrics: meter ? createWebSocketClientMetrics(meter) : undefined,
        }),
      );
    }
  };
}

function snapshotTransport<TResponse>(
  block: OpenTelemetryServerTransportOptions<TResponse> | undefined,
): OpenTelemetryServerTransportOptions<TResponse> | undefined {
  if (block === undefined) return undefined;
  const enabled = block.enabled;
  if (enabled === false) return { enabled: false };
  return {
    enabled,
    startSpanHook: block.startSpanHook,
    requestHook: block.requestHook,
    responseHook: block.responseHook,
  };
}

function snapshotWebSocket(
  block: OpenTelemetryServerWebSocketOptions | undefined,
): OpenTelemetryServerWebSocketOptions | undefined {
  if (block === undefined) return undefined;
  const enabled = block.enabled;
  if (enabled === false) return { enabled: false };
  return {
    enabled,
    startSpanHook: block.startSpanHook,
    requestHook: block.requestHook,
    responseHook: block.responseHook,
    queryPropagation: block.queryPropagation,
  };
}
