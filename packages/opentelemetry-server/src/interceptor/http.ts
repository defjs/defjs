import type { HttpRequest, HttpResponse } from "@defjs/core";
import { createHttpInterceptor } from "@defjs/core";
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
import type { HttpClientMetrics } from "../telemetry/metrics";
import {
  createHttpMetricAttributes,
  durationSeconds,
} from "../telemetry/metrics";
import {
  createHttpSpan,
  httpMethodAttributes,
  normalizeHttpMethod,
  resolveStartSpanHook,
  runSpanHook,
  setSpanError,
  setSpanHttpResponse,
} from "../telemetry/trace";
import { resolveHttpUrl, serverAttributes } from "../telemetry/url";

export interface HttpInterceptorOptions {
  tracer?: Tracer;
  logger?: Logger;
  propagator: TextMapPropagator;
  metrics?: HttpClientMetrics;
  requireParentSpan?: boolean;
  startSpanHook?: (request: HttpRequest) => Attributes;
  requestHook?: (span: Span, req: HttpRequest) => Promise<void> | void;
  responseHook?: (
    span: Span,
    res: HttpResponse<unknown>,
    req: HttpRequest,
  ) => Promise<void> | void;
}

export function createOpenTelemetryHttpInterceptor(
  options: HttpInterceptorOptions,
): ReturnType<typeof createHttpInterceptor> {
  return createHttpInterceptor(async (req, next) => {
    const {
      tracer,
      logger,
      propagator,
      metrics,
      requireParentSpan,
      startSpanHook,
      requestHook,
      responseHook,
    } = options;

    if (tracer && requireParentSpan && !trace.getActiveSpan()) {
      return next(req);
    }

    const parentCtx = propagator.extract(
      context.active(),
      req.headers ?? new Headers(),
      headersGetter,
    );
    const resolved = resolveHttpUrl(req.endpoint, req.baseEndpoint);
    const method = normalizeHttpMethod(req.method);
    let span: Span | undefined;
    if (tracer) {
      const startSpanHookResult = resolveStartSpanHook(startSpanHook, req);
      span = createHttpSpan(
        tracer,
        method,
        resolved.url,
        parentCtx,
        req.operation,
        {
          ...httpMethodAttributes(req.method, method),
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

    if (span) runSpanHook(span, "requestHook", () => requestHook?.(span, req));

    const spanCtx = span ? trace.setSpan(parentCtx, span) : parentCtx;
    const headers = new Headers(req.headers);
    propagator.inject(spanCtx, headers, carrierSetter);

    const startTime = performance.now();

    try {
      const response = await next({ ...req, headers });
      const durationS = durationSeconds(startTime);

      if (span) {
        runSpanHook(span, "responseHook", () =>
          responseHook?.(span, response, req),
        );
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
