import type { HttpRequest } from "@defjs/core";
import type { Attributes, Context } from "@opentelemetry/api";
import type { Span, Tracer } from "@opentelemetry/api";
import { diag, SpanKind, SpanStatusCode } from "@opentelemetry/api";

const spanStatusSet = new WeakMap<Span, boolean>();

function markSpanStatusSet(span: Span): void {
  spanStatusSet.set(span, true);
}

type StartSpanHookResult =
  { ok: true; attributes?: Attributes } | { ok: false; error: unknown };

export function resolveStartSpanHook(
  hook: ((request: HttpRequest) => Attributes) | undefined,
  request: HttpRequest,
): StartSpanHookResult {
  if (!hook) {
    return { ok: true };
  }
  try {
    return { ok: true, attributes: hook(request) };
  } catch (error) {
    return { ok: false, error };
  }
}

export function createHttpSpan(
  tracer: Tracer,
  method: string,
  url: string,
  parentCtx: Context,
  operation?: string,
  startAttributes?: Attributes,
): Span {
  return tracer.startSpan(
    operation ? `${method} ${operation}` : method,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        ...(operation ? { "defjs.operation": operation } : {}),
        "http.request.method": method,
        "url.full": url,
        ...startAttributes,
      },
    },
    parentCtx,
  );
}

export function createSSESpan(
  tracer: Tracer,
  url: string,
  parentCtx: Context,
  operation?: string,
  startAttributes?: Attributes,
): Span {
  return tracer.startSpan(
    operation ? `SSE ${operation}` : "SSE",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        ...(operation ? { "defjs.operation": operation } : {}),
        "url.full": url,
        ...startAttributes,
      },
    },
    parentCtx,
  );
}

export function createWebSocketSpan(
  tracer: Tracer,
  url: string,
  parentCtx: Context,
  operation?: string,
  startAttributes?: Attributes,
): Span {
  return tracer.startSpan(
    operation ? `WebSocket ${operation}` : "WebSocket",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        ...(operation ? { "defjs.operation": operation } : {}),
        "url.full": url,
        ...startAttributes,
      },
    },
    parentCtx,
  );
}

export function setSpanHttpResponse(span: Span, status: number): void {
  if (status !== 0) {
    span.setAttribute("http.response.status_code", status);
  }

  const errorType = getHttpResponseErrorType(status);
  if (errorType) {
    span.setAttribute("error.type", errorType);
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  markSpanStatusSet(span);
  span.end();
}

export function setSpanError(span: Span, error: unknown): void {
  span.recordException(toError(error));
  span.setAttribute("error.type", getErrorType(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
  markSpanStatusSet(span);
  span.end();
}

export function endSpan(span: Span): void {
  if (!spanStatusSet.has(span)) {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

export function runSpanHook(
  span: Span,
  hookName: string,
  hook: (() => Promise<void> | void) | undefined,
): void {
  if (!hook) {
    return;
  }
  try {
    const result = hook();
    void Promise.resolve(result).catch((error) =>
      recordSpanHookError(span, hookName, error),
    );
  } catch (error) {
    recordSpanHookError(span, hookName, error);
  }
}

function recordSpanHookError(
  span: Span,
  hookName: string,
  error: unknown,
): void {
  if (!span.isRecording()) {
    try {
      const { traceId, spanId } = span.spanContext();
      diag.error(
        "@defjs/opentelemetry-server: span hook failed on a non-recording span",
        {
          "hook.name": hookName,
          "error.type": getErrorType(error),
          traceId,
          spanId,
        },
      );
    } catch {
      // Diagnostic reporting must not affect transport execution.
    }
    return;
  }
  try {
    span.addEvent("defjs.otel.hook.error", {
      "hook.name": hookName,
      "error.type": getErrorType(error),
    });
  } catch {
    // Telemetry hooks must not affect transport execution.
  }
  try {
    span.recordException(toError(error));
  } catch {
    // Telemetry hooks must not affect transport execution.
  }
}

export function addSpanEvent(
  span: Span,
  eventName: string,
  attributes?: Attributes,
): void {
  if (attributes) {
    span.addEvent(eventName, attributes);
    return;
  }
  span.addEvent(eventName);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function getHttpResponseErrorType(status: number): string | undefined {
  // Status 0 only reaches here from a synthetic interceptor response; a real transport failure is
  // a fault and never arrives as a response at all.
  if (status >= 400) {
    return String(status);
  }
  return undefined;
}

export function getErrorType(error: unknown): string {
  if (error instanceof Error) {
    return error.name || "Error";
  }
  if (error === undefined || error === null) {
    return "_OTHER";
  }
  return typeof error;
}
