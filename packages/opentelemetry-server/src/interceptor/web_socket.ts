import type { HttpRequest, WebSocketSessionLike } from "@defjs/core";
import { createWebSocketInterceptor, ERR_ABORTED } from "@defjs/core";
import type {
  Attributes,
  Span,
  TextMapPropagator,
  Tracer,
} from "@opentelemetry/api";
import { context, trace } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { carrierSetter, headersGetter } from "../propagation/carrier";
import { emitClientException } from "../telemetry/logs";
import type { WebSocketClientMetrics } from "../telemetry/metrics";
import {
  createConnectionMetricAttributes,
  createErrorMetricAttributes,
  createServerMetricAttributes,
  durationSeconds,
} from "../telemetry/metrics";
import {
  addSpanEvent,
  createWebSocketSpan,
  endSpan,
  resolveStartSpanHook,
  runSpanHook,
  setSpanError,
} from "../telemetry/trace";
import { resolveWebSocketUrl, serverAttributes } from "../telemetry/url";

export interface WebSocketInterceptorOptions {
  tracer?: Tracer;
  logger?: Logger;
  propagator: TextMapPropagator;
  metrics?: WebSocketClientMetrics;
  requireParentSpan?: boolean;
  queryPropagation?: boolean;
  startSpanHook?: (request: HttpRequest) => Attributes;
  requestHook?: (span: Span, req: HttpRequest) => Promise<void> | void;
  responseHook?: (
    span: Span,
    session: WebSocketSessionLike,
    req: HttpRequest,
  ) => Promise<void> | void;
}

export function createOpenTelemetryWebSocketInterceptor(
  options: WebSocketInterceptorOptions,
): ReturnType<typeof createWebSocketInterceptor> {
  return createWebSocketInterceptor(async (req, next) => {
    const {
      tracer,
      logger,
      propagator,
      metrics,
      requireParentSpan,
      queryPropagation = false,
      startSpanHook,
      requestHook,
      responseHook,
    } = options;

    if (tracer && requireParentSpan && !trace.getActiveSpan()) {
      return next(req);
    }

    const resolved = resolveWebSocketUrl(req.endpoint, req.baseEndpoint);

    const parentCtx = propagator.extract(
      context.active(),
      req.headers ?? new Headers(),
      headersGetter,
    );
    let span: Span | undefined;
    if (tracer) {
      const startSpanHookResult = resolveStartSpanHook(startSpanHook, req);
      span = createWebSocketSpan(
        tracer,
        resolved.url,
        parentCtx,
        req.operation,
        {
          // The opening handshake is always a GET (RFC 6455 section 4.1).
          "http.request.method": "GET",
          ...serverAttributes(resolved),
          ...(startSpanHookResult.ok ? startSpanHookResult.attributes : {}),
        },
      );
      if (!startSpanHookResult.ok) {
        runSpanHook(span, "startSpanHook", () => {
          throw startSpanHookResult.error;
        });
      }
    }
    const spanCtx = span ? trace.setSpan(parentCtx, span) : parentCtx;

    let queryParams = req.queryParams;
    let queryString = req.queryString;

    if (queryPropagation) {
      const injected = new URLSearchParams();
      propagator.inject(spanCtx, injected, carrierSetter);
      queryString = replaceInjectedPairs(
        queryString ?? new URLSearchParams(queryParams).toString(),
        injected,
      );
      queryParams = new URLSearchParams(queryString);
    }

    if (span) runSpanHook(span, "requestHook", () => requestHook?.(span, req));

    const connectStartMs = performance.now();

    try {
      const session = await next({ ...req, queryParams, queryString });
      const connectedAtMs = performance.now();
      const activeAttributes = createServerMetricAttributes(req);

      if (span) {
        runSpanHook(span, "responseHook", () =>
          responseHook?.(span, session, req),
        );
        addSpanEvent(span, "websocket.connected");
      }

      metrics?.connectDuration.record(
        durationSeconds(connectStartMs, connectedAtMs),
        createConnectionMetricAttributes(req, "success"),
      );
      metrics?.activeConnections.add(1, activeAttributes);

      const closeActiveConnection = () => {
        metrics?.activeConnections.add(-1, activeAttributes);
      };

      session.closed.then(
        (closeInfo) => {
          closeActiveConnection();
          if (closeInfo.kind === "closed") {
            if (span) addSpanEvent(span, "websocket.closed");
            metrics?.connectionDuration.record(
              durationSeconds(connectedAtMs),
              createConnectionMetricAttributes(req, "success"),
            );
            if (span) endSpan(span);
            return;
          }

          const error =
            closeInfo.kind === "aborted"
              ? (closeInfo.cause ?? ERR_ABORTED)
              : closeInfo.cause;
          if (closeInfo.kind === "error") {
            emitClientException(logger, {
              request: req,
              context: spanCtx,
              error,
              transport: "websocket",
              phase: "connection",
              closeInfo,
            });
          }
          if (span)
            addSpanEvent(
              span,
              "websocket.error",
              createErrorMetricAttributes(error),
            );
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(
              req,
              "error",
              createErrorMetricAttributes(error),
            ),
          );
          if (span) setSpanError(span, error);
        },
        (error: unknown) => {
          closeActiveConnection();
          emitClientException(logger, {
            request: req,
            context: spanCtx,
            error,
            transport: "websocket",
            phase: "connection",
          });
          if (span)
            addSpanEvent(
              span,
              "websocket.error",
              createErrorMetricAttributes(error),
            );
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(
              req,
              "error",
              createErrorMetricAttributes(error),
            ),
          );
          if (span) setSpanError(span, error);
        },
      );

      return session;
    } catch (error) {
      emitClientException(logger, {
        request: req,
        context: spanCtx,
        error,
        transport: "websocket",
        phase: "connect",
      });
      metrics?.connectDuration.record(
        durationSeconds(connectStartMs),
        createConnectionMetricAttributes(
          req,
          "error",
          createErrorMetricAttributes(error),
        ),
      );
      if (span) setSpanError(span, error);
      throw error;
    }
  });
}

/**
 * Put the injected pairs last and drop earlier pairs of the same name, so a receiver reading the first value gets the injected one.
 * Every other pair keeps the bytes it was serialized with.
 */
function replaceInjectedPairs(
  queryString: string,
  injected: URLSearchParams,
): string {
  const added = injected.toString();
  if (!added) return queryString;
  const prefixed = queryString.startsWith("?");
  const query = prefixed ? queryString.slice(1) : queryString;
  // Only the whole query has a '?' prefix. In a pair it is part of the key; '&' prevents stripping it.
  const kept = query
    ? query
        .split("&")
        .filter(
          (pair) =>
            !injected.has(
              new URLSearchParams(`&${pair}`).keys().next().value ?? "",
            ),
        )
    : [];
  const combined = [...kept, added].join("&");
  // A surviving literal '?' key may become first after filtering. Keep it separate from the query prefix.
  return prefixed || combined.startsWith("?") ? `?${combined}` : combined;
}
