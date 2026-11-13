import type { Attributes, Context } from "@opentelemetry/api";
import { diag } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { getExceptionType } from "./trace";

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
  error: unknown;
  /** The attributes the call shares with its span and metrics. */
  attributes: Attributes;
  /** What the transport knows about this failure: the request method, a fault code, a close code. */
  extra?: Attributes;
}

/** Logs a failure. Caller cancellation is not one: the caller decides that with `isCallerCancellation` and logs nothing. */
export function emitClientException(
  logger: Logger | undefined,
  details: ClientExceptionLog,
): void {
  if (!logger) return;

  try {
    const { error, transport } = details;
    if (
      transport === "http" &&
      error instanceof Error &&
      "code" in error &&
      error.code === "HTTP_STATUS"
    )
      return;

    logger.emit({
      ...CLIENT_EXCEPTIONS[transport],
      context: details.context,
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      attributes: {
        ...details.attributes,
        ...details.extra,
        "defjs.phase": details.phase,
        "exception.type": getExceptionType(error),
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
