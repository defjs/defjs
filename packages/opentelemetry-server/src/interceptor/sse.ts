import type { EventStreamCloseInfo, EventStreamHandle } from "@defjs/core";
import { createSSEInterceptor } from "@defjs/core";
import { trace } from "@opentelemetry/api";
import { carrierSetter } from "../propagation/carrier";
import { emitClientException } from "../telemetry/logs";
import type { SSEClientMetrics } from "../telemetry/metrics";
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
import { resolveHttpUrl } from "../telemetry/url";
import type { ClientCallOptions } from "./call";
import { requiresActiveSpan, startClientCall } from "./call";

export type SSEInterceptorOptions = ClientCallOptions<
  EventStreamHandle<unknown>,
  SSEClientMetrics
>;

export function createOpenTelemetrySSEInterceptor(
  options: SSEInterceptorOptions,
): ReturnType<typeof createSSEInterceptor> {
  const { logger, propagator, metrics, responseHook } = options;
  const needsActiveSpan = requiresActiveSpan(options);

  return createSSEInterceptor(async (req, next) => {
    if (needsActiveSpan && !trace.getActiveSpan()) {
      return next(req);
    }

    const { span, context: spanCtx } = startClientCall(
      options,
      req,
      resolveHttpUrl,
      req.method,
      "SSE",
    );
    const headers = new Headers(req.headers);
    propagator.inject(spanCtx, headers, carrierSetter);

    const connectStartMs = performance.now();

    try {
      const stream = await next({ ...req, headers });
      const connectedAtMs = performance.now();
      const activeAttributes = createServerMetricAttributes(req);

      if (span) {
        if (responseHook) {
          runSpanHook(span, "responseHook", () =>
            responseHook(span, stream, req),
          );
        }
        addSpanEvent(span, "sse.connected");
      }

      metrics?.connectDuration.record(
        durationSeconds(connectStartMs, connectedAtMs),
        createConnectionMetricAttributes(req, "success"),
      );
      metrics?.activeStreams.add(1, activeAttributes);

      const closeActiveStream = () => {
        metrics?.activeStreams.add(-1, activeAttributes);
      };

      stream.closed.then(
        (closeInfo: EventStreamCloseInfo) => {
          closeActiveStream();
          const closeAttributes = {
            "sse.close.kind": closeInfo.kind,
            ...(closeInfo.kind === "error"
              ? { "defjs.sse.fault.code": closeInfo.code }
              : {}),
          };

          if (closeInfo.kind === "error") {
            const errorAttributes = {
              ...closeAttributes,
              "error.type": getErrorType(closeInfo.cause),
            };
            emitClientException(logger, {
              request: req,
              context: spanCtx,
              error: closeInfo.cause,
              transport: "sse",
              phase: "connection",
              closeInfo,
            });
            if (span) addSpanEvent(span, "sse.error", errorAttributes);
            metrics?.connectionDuration.record(
              durationSeconds(connectedAtMs),
              createConnectionMetricAttributes(req, "error", errorAttributes),
            );
            if (span) setSpanError(span, closeInfo.cause);
            return;
          }

          if (span)
            addSpanEvent(
              span,
              closeInfo.kind === "aborted" ? "sse.aborted" : "sse.closed",
              closeAttributes,
            );
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(req, "success", closeAttributes),
          );
          span?.end();
        },
        (error: unknown) => {
          closeActiveStream();
          emitClientException(logger, {
            request: req,
            context: spanCtx,
            error,
            transport: "sse",
            phase: "connection",
          });
          const errorAttributes = { "error.type": getErrorType(error) };
          if (span) addSpanEvent(span, "sse.error", errorAttributes);
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(req, "error", errorAttributes),
          );
          if (span) setSpanError(span, error);
        },
      );

      return stream;
    } catch (error) {
      emitClientException(logger, {
        request: req,
        context: spanCtx,
        error,
        transport: "sse",
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
