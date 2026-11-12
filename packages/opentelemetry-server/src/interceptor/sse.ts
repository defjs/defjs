import type { EventStreamCloseInfo, EventStreamHandle } from "@defjs/core";
import { createSSEInterceptor } from "@defjs/core";
import { trace } from "@opentelemetry/api";
import { carrierSetter } from "../propagation/carrier";
import { emitClientException } from "../telemetry/logs";
import type { SSEClientMetrics } from "../telemetry/metrics";
import { durationSeconds } from "../telemetry/metrics";
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

    const {
      span,
      context: spanCtx,
      attributes,
    } = startClientCall(options, req, resolveHttpUrl, req.method, "SSE");
    const headers = new Headers(req.headers);
    propagator.inject(spanCtx, headers, carrierSetter);

    const connectStartMs = performance.now();

    try {
      const stream = await next({ ...req, headers });
      const connectedAtMs = performance.now();

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
        { ...attributes, "defjs.result": "success" },
      );
      metrics?.activeStreams.add(1, attributes);

      const closeActiveStream = () => {
        metrics?.activeStreams.add(-1, attributes);
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
              transport: "sse",
              phase: "connection",
              context: spanCtx,
              signal: req.signal,
              error: closeInfo.cause,
              attributes,
              extra: { "defjs.sse.fault.code": closeInfo.code },
            });
            if (span) addSpanEvent(span, "sse.error", errorAttributes);
            metrics?.connectionDuration.record(durationSeconds(connectedAtMs), {
              ...attributes,
              "defjs.result": "error",
              ...errorAttributes,
            });
            if (span) setSpanError(span, closeInfo.cause);
            return;
          }

          if (span)
            addSpanEvent(
              span,
              closeInfo.kind === "aborted" ? "sse.aborted" : "sse.closed",
              closeAttributes,
            );
          metrics?.connectionDuration.record(durationSeconds(connectedAtMs), {
            ...attributes,
            "defjs.result": "success",
            ...closeAttributes,
          });
          span?.end();
        },
        (error: unknown) => {
          closeActiveStream();
          emitClientException(logger, {
            transport: "sse",
            phase: "connection",
            context: spanCtx,
            signal: req.signal,
            error,
            attributes,
          });
          const errorAttributes = { "error.type": getErrorType(error) };
          if (span) addSpanEvent(span, "sse.error", errorAttributes);
          metrics?.connectionDuration.record(durationSeconds(connectedAtMs), {
            ...attributes,
            "defjs.result": "error",
            ...errorAttributes,
          });
          if (span) setSpanError(span, error);
        },
      );

      return stream;
    } catch (error) {
      emitClientException(logger, {
        transport: "sse",
        phase: "connect",
        context: spanCtx,
        signal: req.signal,
        error,
        attributes,
      });
      metrics?.connectDuration.record(durationSeconds(connectStartMs), {
        ...attributes,
        "defjs.result": "error",
        "error.type": getErrorType(error),
      });
      if (span) setSpanError(span, error);
      throw error;
    }
  });
}
