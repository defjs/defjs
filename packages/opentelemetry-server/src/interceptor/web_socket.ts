import type { WebSocketSessionLike } from "@defjs/core";
import { createWebSocketInterceptor, ERR_ABORTED } from "@defjs/core";
import { trace } from "@opentelemetry/api";
import { carrierSetter } from "../propagation/carrier";
import { emitClientException } from "../telemetry/logs";
import type { WebSocketClientMetrics } from "../telemetry/metrics";
import {
  createConnectionMetricAttributes,
  createServerMetricAttributes,
  durationSeconds,
} from "../telemetry/metrics";
import {
  addSpanEvent,
  getErrorType,
  runSpanHook,
  setSpanError,
} from "../telemetry/trace";
import { resolveWebSocketUrl } from "../telemetry/url";
import type { ClientCallOptions } from "./call";
import { requiresActiveSpan, startClientCall } from "./call";

export interface WebSocketInterceptorOptions extends ClientCallOptions<
  WebSocketSessionLike,
  WebSocketClientMetrics
> {
  queryPropagation?: boolean;
}

export function createOpenTelemetryWebSocketInterceptor(
  options: WebSocketInterceptorOptions,
): ReturnType<typeof createWebSocketInterceptor> {
  const { logger, propagator, metrics, queryPropagation, responseHook } =
    options;
  const needsActiveSpan = requiresActiveSpan(options);

  return createWebSocketInterceptor(async (req, next) => {
    if (needsActiveSpan && !trace.getActiveSpan()) {
      return next(req);
    }

    // The opening handshake is always a GET (RFC 6455 section 4.1).
    const { span, context: spanCtx } = startClientCall(
      options,
      req,
      resolveWebSocketUrl,
      "GET",
      "WebSocket",
    );

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

    const connectStartMs = performance.now();

    try {
      const session = await next({ ...req, queryParams, queryString });
      const connectedAtMs = performance.now();
      const activeAttributes = createServerMetricAttributes(req);

      if (span) {
        if (responseHook) {
          runSpanHook(span, "responseHook", () =>
            responseHook(span, session, req),
          );
        }
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
            span?.end();
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
          const errorAttributes = { "error.type": getErrorType(error) };
          if (span) addSpanEvent(span, "websocket.error", errorAttributes);
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(req, "error", errorAttributes),
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
          const errorAttributes = { "error.type": getErrorType(error) };
          if (span) addSpanEvent(span, "websocket.error", errorAttributes);
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(req, "error", errorAttributes),
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
        createConnectionMetricAttributes(req, "error", {
          "error.type": getErrorType(error),
        }),
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
