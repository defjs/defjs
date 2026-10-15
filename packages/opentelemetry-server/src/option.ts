import type { ClientOption, EventStreamHandle, HttpRequest, HttpResponse, WebSocketSessionLike } from '@defjs/core'
import type { Attributes, Meter, Span, TextMapPropagator, Tracer } from '@opentelemetry/api'
import type { Logger } from '@opentelemetry/api-logs'
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core'
import { createOpenTelemetryHttpInterceptor } from './interceptor/http'
import { createOpenTelemetrySSEInterceptor } from './interceptor/sse'
import { createOpenTelemetryWebSocketInterceptor } from './interceptor/web_socket'
import { createHttpClientMetrics, createSSEClientMetrics, createWebSocketClientMetrics } from './telemetry/metrics'

/** Shared per-transport OpenTelemetry client options. */
export interface OpenTelemetryServerTransportOptions<TResponse> {
  /** Whether this transport's instrumentation is enabled. Defaults to `true`. */
  enabled?: boolean
  /** Add application attributes when the client span is created. */
  startSpanHook?: (request: HttpRequest) => Attributes
  /** Customize the client span before the request is sent. */
  requestHook?: (span: Span, req: HttpRequest) => Promise<void> | void
  /** Customize the client span after the transport result is returned. */
  responseHook?: (span: Span, res: TResponse, req: HttpRequest) => Promise<void> | void
}

export type OpenTelemetryServerHttpOptions = OpenTelemetryServerTransportOptions<HttpResponse<unknown>>
export type OpenTelemetryServerSSEOptions = OpenTelemetryServerTransportOptions<EventStreamHandle<unknown>>
export interface OpenTelemetryServerWebSocketOptions extends OpenTelemetryServerTransportOptions<WebSocketSessionLike> {
  /**
   * Inject trace context into the WebSocket URL query string.
   * Defaults to `false`; enable only after reviewing URL propagation exposure.
   */
  queryPropagation?: boolean
}

/**
 * Options for {@link withOpenTelemetryServer}.
 *
 * Pass application-owned OpenTelemetry `Tracer`, `Meter`, and/or `Logger` handles.
 * This package does not initialize the OpenTelemetry SDK.
 */
export interface OpenTelemetryServerOptions {
  /** Optional tracer; omitting it disables outbound spans and span hooks. */
  tracer?: Tracer
  /** Optional meter; when set, per-transport client metrics are recorded. */
  meter?: Meter
  /** Optional logger; emits WARN diagnostics for failed outbound requests and connections. */
  logger?: Logger
  /** Context propagator. Defaults to W3C Trace Context + Baggage. */
  propagator?: TextMapPropagator
  /** With a tracer, bypass instrumentation when no active parent span exists. Ignored without a tracer. */
  requireParentSpan?: boolean
  /** HTTP transport instrumentation options. */
  http?: OpenTelemetryServerHttpOptions
  /** SSE transport instrumentation options. */
  sse?: OpenTelemetryServerSSEOptions
  /** WebSocket transport instrumentation options. */
  webSocket?: OpenTelemetryServerWebSocketOptions
}

interface TransportSwitch {
  enabled?: boolean
}

/**
 * Client option that installs outbound OpenTelemetry interceptors for HTTP, SSE, and WebSocket.
 *
 * Does not initialize the OpenTelemetry SDK or acquire global handles. Supply a `tracer`, `meter`, and/or `logger` from your app.
 * Each transport can be toggled or customized via `http`, `sse`, and `webSocket`.
 *
 * @param options - Optional tracer/meter/logger/propagator and per-transport settings.
 * @returns A `ClientOption` for `createClient(...)`.
 *
 * @example
 * ```ts
 * const client = createClient(
 *   withEndpoint('https://api.example.com'),
 *   withOpenTelemetryServer({ tracer }),
 * )
 * ```
 */
export function withOpenTelemetryServer(options: OpenTelemetryServerOptions): ClientOption {
  const {
    tracer,
    meter,
    logger,
    propagator = new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
    requireParentSpan = false,
  } = options

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
      )
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
      )
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
      )
    }
  }
}

function isTransportEnabled(option: TransportSwitch | undefined): boolean {
  return option?.enabled !== false
}
