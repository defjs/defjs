import { isAbortCause, isTimeoutCause } from "@defjs/core";
import type { Attributes, Context } from "@opentelemetry/api";
import { diag } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { getErrorType } from "./trace";

const CLIENT_EXCEPTIONS = {
  http: {
    eventName: "http.client.request.exception",
    body: "HTTP client request failed",
  },
  sse: {
    eventName: "defjs.client.sse.exception",
    body: "SSE client connection failed",
  },
  websocket: {
    eventName: "defjs.client.websocket.exception",
    body: "WebSocket client connection failed",
  },
} as const;

interface ClientExceptionLog {
  transport: "http" | "sse" | "websocket";
  phase: "request" | "connect" | "connection";
  context: Context;
  /** The signal of the request; see {@link isCallerCancellation}. */
  signal: AbortSignal | undefined;
  error: unknown;
  /** The attributes the call shares with its span and metrics. */
  attributes: Attributes;
  /** What the transport knows about this failure: the request method, a fault code, a close code. */
  extra?: Attributes;
}

/**
 * Caller cancellation produces no log. An abort whose reason is `TimeoutError` or `ERR_TIMEOUT` still logs.
 *
 * An aborted `signal` alone is not cancellation: WebSocket `finish()` aborts that same signal
 * when a connect fails. Cancellation is an abort sentinel from any `@defjs/core` copy, or an
 * `AbortError`, on the rejection or on `signal.reason`. There is no `timeout` option.
 */
function isCallerCancellation(
  signal: AbortSignal | undefined,
  error: unknown,
): boolean {
  const reason: unknown = signal?.reason;
  if (isTimeoutCause(error) || isTimeoutCause(reason)) return false;
  return isAbortCause(error) || isAbortCause(reason);
}

export function emitClientException(
  logger: Logger | undefined,
  details: ClientExceptionLog,
): void {
  if (!logger) return;

  try {
    const { error, transport } = details;
    if (isCallerCancellation(details.signal, error)) return;
    if (error instanceof Error && "code" in error) {
      if (
        error.code === "NET_ABORTED" ||
        (transport === "http" && error.code === "HTTP_STATUS")
      )
        return;
    }

    logger.emit({
      ...CLIENT_EXCEPTIONS[transport],
      context: details.context,
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      attributes: {
        ...details.attributes,
        ...details.extra,
        "defjs.phase": details.phase,
        "exception.type": getErrorType(error),
      },
    });
  } catch {
    try {
      diag.error(
        "@defjs/opentelemetry-server: failed to emit client diagnostic log",
      );
    } catch {
      // Diagnostic reporting must not replace the transport outcome either.
    }
  }
}
