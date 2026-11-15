import type { Attributes, Context } from "@opentelemetry/api";
import { diag } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { describeError, getExceptionType } from "./trace";

const CLIENT_EXCEPTIONS = {
  operation: {
    eventName: "defjs.client.operation.exception",
    body: "Defjs operation failed",
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
  /** A failed operation call, or an SSE or WebSocket connection that failed after it opened. */
  kind: "operation" | "sse" | "websocket";
  context: Context;
  error: unknown;
  /** The record's attributes; `exception.*` is added from `error`. */
  attributes: Attributes;
  /** Adds `exception.message` and `exception.stacktrace`. */
  includeErrorDiagnostics: boolean;
}

/** Logs a failure. Caller cancellation is not one: the caller decides that and logs nothing. */
export function emitClientException(
  logger: Logger | undefined,
  details: ClientExceptionLog,
): void {
  if (!logger) return;

  try {
    const { error } = details;
    logger.emit({
      ...CLIENT_EXCEPTIONS[details.kind],
      context: details.context,
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      attributes: {
        ...details.attributes,
        "exception.type": getExceptionType(error),
        ...(details.includeErrorDiagnostics && exceptionText(error)),
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

/** `exception.message` and `exception.stacktrace`, the second only when the error has a stack. */
function exceptionText(error: unknown): Attributes {
  const { message, stack } = describeError(error);
  return stack === undefined
    ? { "exception.message": message }
    : { "exception.message": message, "exception.stacktrace": stack };
}
