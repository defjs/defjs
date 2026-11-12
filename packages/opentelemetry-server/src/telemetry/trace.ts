import { isAbortCause, isTimeoutCause } from "@defjs/core";
import type { Span } from "@opentelemetry/api";
import { diag, SpanStatusCode } from "@opentelemetry/api";

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
 * `http.request.method` of a request sent through Fetch: the method as it goes on the wire, or
 * `_OTHER` when that is not a known method.
 */
export function normalizeHttpMethod(method: string): string {
  if (KNOWN_HTTP_METHODS.has(method)) return method;
  const upper = method.toUpperCase();
  return FETCH_NORMALIZED_METHODS.has(upper) ? upper : "_OTHER";
}

export function endSpanWithResponse(span: Span, status: number): void {
  if (status !== 0) {
    span.setAttribute("http.response.status_code", status);
  }

  const errorType = getHttpResponseErrorType(status);
  if (errorType) {
    span.setAttribute("error.type", errorType);
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end();
}

// The runtime's error text (Node's fetch message with the full URL, a JSON parse error with a body
// fragment) and its stack can carry credentials, query values or body content, so the exception
// event keeps only `exception.type`, the same field the diagnostic logs emit.
function recordSpanException(span: Span, error: unknown): void {
  span.recordException({ name: getExceptionType(error) });
}

export function endSpanWithError(span: Span, error: unknown): void {
  recordSpanException(span, error);
  span.setAttribute("error.type", getErrorType(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
}

/** Caller cancellation is not a failure: the span records `<transport>.aborted` and keeps its status unset. */
export function endSpanAborted(
  span: Span,
  transport: "http" | "sse" | "websocket",
): void {
  span.addEvent(`${transport}.aborted`);
  span.end();
}

/**
 * Whether `error` is the caller cancelling the call, which is not a failure. An abort whose reason is
 * `TimeoutError` or `ERR_TIMEOUT` is a timeout and stays one.
 *
 * An aborted `signal` alone is not cancellation: WebSocket `finish()` aborts that same signal
 * when a connect fails. Cancellation is a `NET_ABORTED` fault, an abort sentinel from any
 * `@defjs/core` copy, or an `AbortError`, on the rejection or on `signal.reason`. There is no
 * `timeout` option.
 */
export function isCallerCancellation(
  signal: AbortSignal | undefined,
  error: unknown,
): boolean {
  if (error instanceof Error && "code" in error && error.code === "NET_ABORTED")
    return true;
  const reason: unknown = signal?.reason;
  // A failure that is no abort at all is the common case; it never reaches the timeout checks.
  if (!isAbortCause(error) && !isAbortCause(reason)) return false;
  return !isTimeoutCause(error) && !isTimeoutCause(reason);
}

export function runSpanHook(
  span: Span,
  hookName: string,
  hook: () => Promise<void> | void,
): void {
  try {
    const result = hook();
    void Promise.resolve(result).catch((error) =>
      recordSpanHookError(span, hookName, error),
    );
  } catch (error) {
    recordSpanHookError(span, hookName, error);
  }
}

export function recordSpanHookError(
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
    recordSpanException(span, error);
  } catch {
    // Telemetry hooks must not affect transport execution.
  }
}

export function getHttpResponseErrorType(status: number): string | undefined {
  // Status 0 only reaches here from a synthetic interceptor response; a real transport failure is
  // a fault and never arrives as a response at all.
  if (status >= 400) {
    return String(status);
  }
  return undefined;
}

/** `error.type` of a failed call: `timeout` for a timeout, otherwise the class name of the error. */
export function getErrorType(error: unknown): string {
  return isTimeoutCause(error) ? "timeout" : getExceptionType(error);
}

/** `exception.type` of a failure: the class name of the error, not a Defjs fault code. */
export function getExceptionType(error: unknown): string {
  if (error instanceof Error) {
    return error.name || "Error";
  }
  if (error === undefined || error === null) {
    return "_OTHER";
  }
  return typeof error;
}
