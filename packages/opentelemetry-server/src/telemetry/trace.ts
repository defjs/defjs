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
  try {
    return { ok: true, attributes: hook?.(request) };
  } catch (error) {
    return { ok: false, error };
  }
}

// Fetch writes only these six methods in upper case; every other method goes on the wire as given.
const FETCH_NORMALIZED_METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
]);

// The known methods of the HTTP semantic conventions: RFC 9110, PATCH and QUERY.
const KNOWN_HTTP_METHODS: ReadonlySet<string> = new Set([
  ...FETCH_NORMALIZED_METHODS,
  "CONNECT",
  "PATCH",
  "QUERY",
  "TRACE",
]);

/**
 * `http.request.method` for a span of a request sent through Fetch: the method as it goes on the wire,
 * or `_OTHER` when it is not a known method, with the method as given in `http.request.method_original`
 * whenever the two differ.
 */
export function httpMethodAttributes(method: string): Attributes {
  const upper = method.toUpperCase();
  const sent = FETCH_NORMALIZED_METHODS.has(upper) ? upper : method;
  const value = KNOWN_HTTP_METHODS.has(sent) ? sent : "_OTHER";
  return value === method
    ? { "http.request.method": value }
    : { "http.request.method": value, "http.request.method_original": method };
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
  span.addEvent(eventName, attributes);
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
