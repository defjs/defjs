import type { HttpResponse } from "@defjs/core";
import { createHttpInterceptor } from "@defjs/core";
import { trace } from "@opentelemetry/api";
import { carrierSetter } from "../propagation/carrier";
import { emitClientException } from "../telemetry/logs";
import type { HttpClientMetrics } from "../telemetry/metrics";
import {
  createHttpMetricAttributes,
  durationSeconds,
} from "../telemetry/metrics";
import {
  runSpanHook,
  setSpanError,
  setSpanHttpResponse,
} from "../telemetry/trace";
import { resolveHttpUrl } from "../telemetry/url";
import type { ClientCallOptions } from "./call";
import { requiresActiveSpan, startClientCall } from "./call";

export type HttpInterceptorOptions = ClientCallOptions<
  HttpResponse<unknown>,
  HttpClientMetrics
>;

export function createOpenTelemetryHttpInterceptor(
  options: HttpInterceptorOptions,
): ReturnType<typeof createHttpInterceptor> {
  const { logger, propagator, metrics, responseHook } = options;
  const needsActiveSpan = requiresActiveSpan(options);

  return createHttpInterceptor(async (req, next) => {
    if (needsActiveSpan && !trace.getActiveSpan()) {
      return next(req);
    }

    const {
      span,
      context: spanCtx,
      method,
    } = startClientCall(options, req, resolveHttpUrl, req.method);
    const headers = new Headers(req.headers);
    propagator.inject(spanCtx, headers, carrierSetter);

    const startTime = performance.now();

    try {
      const response = await next({ ...req, headers });
      const durationS = durationSeconds(startTime);

      if (span) {
        if (responseHook) {
          runSpanHook(span, "responseHook", () =>
            responseHook(span, response, req),
          );
        }
        setSpanHttpResponse(span, response.status);
      }

      metrics?.requestDuration.record(
        durationS,
        createHttpMetricAttributes(req, method, response),
      );

      return response;
    } catch (error) {
      const durationS = durationSeconds(startTime);

      emitClientException(logger, {
        request: req,
        context: spanCtx,
        error,
        transport: "http",
        phase: "request",
      });

      if (span) setSpanError(span, error);
      metrics?.requestDuration.record(
        durationS,
        createHttpMetricAttributes(req, method, undefined, error),
      );

      throw error;
    }
  });
}
