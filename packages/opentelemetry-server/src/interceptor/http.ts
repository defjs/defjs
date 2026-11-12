import type { HttpResponse } from "@defjs/core";
import { createHttpInterceptor } from "@defjs/core";
import type { Attributes } from "@opentelemetry/api";
import { trace } from "@opentelemetry/api";
import { carrierSetter } from "../propagation/carrier";
import { emitClientException } from "../telemetry/logs";
import type { HttpClientMetrics } from "../telemetry/metrics";
import { durationSeconds } from "../telemetry/metrics";
import {
  getErrorType,
  getHttpResponseErrorType,
  runSpanHook,
  setSpanError,
  setSpanHttpResponse,
} from "../telemetry/trace";
import { resolveHttpUrl } from "../telemetry/url";
import type { ClientCall, ClientCallOptions } from "./call";
import { requiresActiveSpan, startClientCall } from "./call";

export type HttpInterceptorOptions = ClientCallOptions<
  HttpResponse<unknown>,
  HttpClientMetrics
>;

function responseMetricAttributes(
  call: ClientCall,
  status: number,
): Attributes {
  const attributes: Attributes = {
    ...call.attributes,
    "http.request.method": call.method,
  };
  // Status 0 is a synthetic interceptor response and carries nothing to report.
  if (status !== 0) attributes["http.response.status_code"] = status;
  const errorType = getHttpResponseErrorType(status);
  if (errorType) attributes["error.type"] = errorType;
  return attributes;
}

export function createOpenTelemetryHttpInterceptor(
  options: HttpInterceptorOptions,
): ReturnType<typeof createHttpInterceptor> {
  const { logger, propagator, metrics, responseHook } = options;
  const needsActiveSpan = requiresActiveSpan(options);

  return createHttpInterceptor(async (req, next) => {
    if (needsActiveSpan && !trace.getActiveSpan()) {
      return next(req);
    }

    const call = startClientCall(options, req, resolveHttpUrl, req.method);
    const { span } = call;
    const headers = new Headers(req.headers);
    propagator.inject(call.context, headers, carrierSetter);

    const startTime = performance.now();

    let response: HttpResponse<unknown>;
    try {
      response = await next({ ...req, headers });
    } catch (error) {
      const durationS = durationSeconds(startTime);

      emitClientException(logger, {
        transport: "http",
        phase: "request",
        context: call.context,
        signal: req.signal,
        error,
        attributes: call.attributes,
        extra: { "http.request.method": call.method },
      });

      if (span) setSpanError(span, error);
      metrics?.requestDuration.record(durationS, {
        ...call.attributes,
        "http.request.method": call.method,
        "error.type": getErrorType(error),
      });

      throw error;
    }
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
      responseMetricAttributes(call, response.status),
    );

    return response;
  });
}
