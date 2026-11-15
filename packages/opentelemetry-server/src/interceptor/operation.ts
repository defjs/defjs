import type { OperationCall, OperationInterceptor } from "@defjs/core";
import { createOperationInterceptor } from "@defjs/core";
import type { Attributes, Tracer } from "@opentelemetry/api";
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { emitClientException } from "../telemetry/logs";
import type { OperationClientMetrics } from "../telemetry/metrics";
import { durationSeconds } from "../telemetry/metrics";
import { normalizeHttpMethod } from "../telemetry/trace";
import { metaAttributes, NO_ATTRIBUTES } from "./call";

export interface OperationInterceptorOptions {
  tracer?: Tracer;
  logger?: Logger;
  metrics?: OperationClientMetrics;
  includeErrorDiagnostics: boolean;
  /** The transports whose operations are observed; the others pass through. */
  transports: ReadonlySet<OperationCall["transport"]>;
}

const ABORTED_EVENT = {
  http: "http.aborted",
  sse: "sse.aborted",
  websocket: "websocket.aborted",
} as const;

/**
 * `defjs.operation.name`, also the name of the operation span: what names the transport span, then the path template.
 * The template is low-cardinality, which is what makes it a span name and a metric attribute.
 */
export function operationName(call: OperationCall): string {
  switch (call.transport) {
    case "sse":
      return `SSE ${call.path}`;
    case "websocket":
      return `WebSocket ${call.path}`;
    default: {
      const method = normalizeHttpMethod(call.method);
      return `${method === "_OTHER" ? "HTTP" : method} ${call.path}`;
    }
  }
}

/**
 * Observes every operation call from the call to its result tuple: an `INTERNAL` span that is the parent of the
 * transport spans, one `defjs.client.operation.duration` sample, and one log when the call fails.
 */
export function createOpenTelemetryOperationInterceptor(
  options: OperationInterceptorOptions,
): OperationInterceptor {
  const { tracer, logger, metrics, includeErrorDiagnostics, transports } =
    options;

  return createOperationInterceptor(async (call, next) => {
    if (!transports.has(call.transport)) return next();

    const name = operationName(call);
    const meta =
      call.meta && (tracer || logger)
        ? metaAttributes(call.meta)
        : NO_ATTRIBUTES;
    const parent = context.active();
    const span = tracer?.startSpan(
      name,
      {
        kind: SpanKind.INTERNAL,
        attributes: { ...meta, "defjs.operation.name": name },
      },
      parent,
    );
    const active = span ? trace.setSpan(parent, span) : parent;
    const startTime = performance.now();

    // The whole call runs with the operation span active, so the transport spans are its children.
    const result = await (span ? context.with(active, next) : next());

    const durationS = durationSeconds(startTime);
    const fault = result[0];
    const attributes: Attributes = { "defjs.operation.name": name };
    // Caller cancellation is not a failure: no error status, no `error.type`, no log.
    if (fault === null || fault.code === "NET_ABORTED") {
      if (fault !== null) span?.addEvent(ABORTED_EVENT[call.transport]);
      span?.end();
      metrics?.operationDuration.record(durationS, attributes);
      return result;
    }

    attributes["error.type"] = fault.code;
    if (span) {
      span.setAttribute("error.type", fault.code);
      span.setStatus(
        includeErrorDiagnostics
          ? { code: SpanStatusCode.ERROR, message: fault.message }
          : { code: SpanStatusCode.ERROR },
      );
      span.end();
    }
    metrics?.operationDuration.record(durationS, attributes);
    emitClientException(logger, {
      kind: "operation",
      context: active,
      error: fault,
      attributes: { ...meta, ...attributes },
      includeErrorDiagnostics,
    });
    return result;
  });
}
