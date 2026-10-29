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
 * `enabled` defaults to `true`; only `enabled: false` turns the transport off. The old boolean switch (`http: false`) and top-level hooks are rejected by the TypeScript types only. There is no runtime check, so at runtime `http: false` leaves the transport enabled and a top-level hook is silently ignored.
 *
 * Span hooks run only when a `tracer` is supplied. `startSpanHook` runs synchronously before span creation for its own transport. Its attributes are applied after built-in attributes, so the application may override `url.full` or another initial value. If it throws, Defjs creates the span with built-in attributes and continues the request. `requestHook` runs after span creation and before the request is sent; `responseHook` runs after the transport result is returned. Both may return a promise, but neither is awaited: a throw or rejection never blocks or fails the operation. `responseHook` receives the original request as its third argument.
 *
 * While `span.isRecording()` is true, hook failures record `defjs.otel.hook.error` and `exception` events. For non-recording spans (ended or unsampled), failures go to the OpenTelemetry diagnostic logger through `diag.error`. Applications must configure `diag.setLogger(...)` from `@opentelemetry/api` to receive them; there is no automatic output by default. The package does not initialize the SDK, and this diagnostic is not a separate SDK `LogRecord`.
 *
 * By default, `url.full` resolves only `request.endpoint` against optional `request.baseEndpoint`; an independent `request.queryString` is not appended. That boundary is not redaction, and the package has no built-in redactor or sensitive-key policy. Construct and, if needed, redact an application-owned URL explicitly.
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
 * - `responseHook(span, res, req)` receives the `HttpResponse` that came back through the interceptor, before the client decodes a declared body, together with the original `HttpRequest`. Read `req.operation` for the request identity; do not rebuild it from the endpoint or a resolved URL.
 *
 * - The HTTP span ends as soon as `responseHook` returns; the hook is not awaited, so only its synchronous part can still change the span. A status of 400 or above ends it `ERROR` with `error.type` set to the status string; 100–399 leaves its status unset. An asynchronous hook rejection after end is reported through `diag.error`; configure `diag.setLogger(...)` from `@opentelemetry/api` to receive it. It cannot append events to an ended span.
 *
 * - A rejection through the interceptor has no response status and does not call `responseHook`. That includes a network failure, cancellation, timeout, any declared-body read failure (`BodyFailure`, including text, blob, and bytes, not only JSON), and a progress observer failure (`EXT_OBSERVER_FAILED`). The span ends `ERROR` with `error.type` set to the thrown class name, such as `TypeError`, `Error` or `BodyFailure`. Caller cancellation is `Error` whatever the abort reason.
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
 * - SSE is traced at connection level. After startup the span stays open until `stream.closed` settles, and records `sse.connected`, then one of `sse.closed` (server EOF), `sse.aborted` (`stream.close()` or a non-timeout caller abort of the open stream; the span still ends without error), or `sse.error` (including a timeout-shaped abort, which ends the span `ERROR`). No per-event spans are created.
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
 * WebSocket is traced at connection level. The span stays open until `session.closed` settles. It records `websocket.connected`, then `websocket.closed` for a normal close or `websocket.error`. A close frame from the server counts as normal with any code, including 1011. An abrupt drop without a close frame (1006) is normal only where the runtime reports no socket `error` before `close` (Bun); where it does (Node.js), the session ends in error and logs once. A caller abort of an open session is also `websocket.error`: the span ends `ERROR` and no log is emitted. `error.type` follows the abort reason: `AbortError` for a default `abort()`, the `Error.name` of an `Error` reason, `string` for a string reason. An abort while the WebSocket is still connecting ends the span `ERROR` with `error.type` `DefjsFault`. No per-message spans are created.
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
 * - `http`, `sse`, `webSocket` — Per-transport options. Each defaults to `{}`; a transport is disabled only by `{ enabled: false }`.
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

interface TransportSwitch {
  enabled?: boolean;
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

  return (config) => {
    if (isTransportEnabled(options.http)) {
      config.interceptors.push(
        createOpenTelemetryHttpInterceptor({
          tracer,
          logger,
          propagator,
          metrics: meter ? createHttpClientMetrics(meter) : undefined,
          requireParentSpan,
          startSpanHook: options.http?.startSpanHook,
          requestHook: options.http?.requestHook,
          responseHook: options.http?.responseHook,
        }),
      );
    }

    if (isTransportEnabled(options.sse)) {
      config.interceptors.push(
        createOpenTelemetrySSEInterceptor({
          tracer,
          logger,
          propagator,
          metrics: meter ? createSSEClientMetrics(meter) : undefined,
          requireParentSpan,
          startSpanHook: options.sse?.startSpanHook,
          requestHook: options.sse?.requestHook,
          responseHook: options.sse?.responseHook,
        }),
      );
    }

    if (isTransportEnabled(options.webSocket)) {
      config.interceptors.push(
        createOpenTelemetryWebSocketInterceptor({
          tracer,
          logger,
          propagator,
          metrics: meter ? createWebSocketClientMetrics(meter) : undefined,
          requireParentSpan,
          queryPropagation: options.webSocket?.queryPropagation,
          startSpanHook: options.webSocket?.startSpanHook,
          requestHook: options.webSocket?.requestHook,
          responseHook: options.webSocket?.responseHook,
        }),
      );
    }
  };
}

function isTransportEnabled(option: TransportSwitch | undefined): boolean {
  return option?.enabled !== false;
}
