import type { HttpRequest } from "@defjs/core";
import type { Attributes } from "@opentelemetry/api";
import { context } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { emitClientException } from "../telemetry/logs";
import type { ConnectionClientMetrics } from "../telemetry/metrics";
import { durationSeconds } from "../telemetry/metrics";
import {
  getErrorType,
  isCallerCancellation,
  runSpanHook,
  endSpanAborted,
  endSpanWithError,
} from "../telemetry/trace";
import type { ClientCall, ClientCallOptions } from "./call";

/** How a connection ended, as plain data: what to record and how the span ends. */
export type Outcome =
  | {
      /** The event is `<transport>.<end>`. */
      end: "closed" | "aborted";
      /** Attributes of the event and of the connection duration sample. */
      attributes?: Attributes;
    }
  | {
      end: "error";
      error: unknown;
      /** Attributes of the event and of the connection duration sample; `error.type` is added. */
      attributes?: Attributes;
      /** What the transport adds to the log record. */
      extra?: Attributes;
    };

/** `defjs.result` of the connection metrics: a cancelled connection is neither a success nor an error. */
const RESULT = {
  closed: "success",
  aborted: "aborted",
  error: "error",
} as const;

/** What finishing a connection needs from the call that opened it. */
interface ConnectionRecord {
  transport: "sse" | "websocket";
  call: ClientCall;
  logger: Logger | undefined;
  metrics: ConnectionClientMetrics | undefined;
  signal: AbortSignal | undefined;
  connectedAtMs: number;
}

/** A failure the caller caused is the same cancellation as a close that says so. */
function settle(signal: AbortSignal | undefined, outcome: Outcome): Outcome {
  return outcome.end === "error" && isCallerCancellation(signal, outcome.error)
    ? { end: "aborted", attributes: outcome.attributes }
    : outcome;
}

function finishConnection(
  { transport, call, logger, metrics, signal, connectedAtMs }: ConnectionRecord,
  recorded: Outcome,
): void {
  const outcome = settle(signal, recorded);
  const { span } = call;
  metrics?.active.add(-1, call.attributes);
  const failed = outcome.end === "error";
  let attributes = outcome.attributes;
  if (failed) {
    emitClientException(logger, {
      transport,
      phase: "connection",
      context: call.context,
      error: outcome.error,
      attributes: call.attributes,
      meta: call.meta,
      extra: outcome.extra,
    });
    attributes = { ...attributes, "error.type": getErrorType(outcome.error) };
  }
  span?.addEvent(`${transport}.${outcome.end}`, attributes);
  metrics?.connectionDuration.record(durationSeconds(connectedAtMs), {
    ...call.attributes,
    "defjs.result": RESULT[outcome.end],
    ...attributes,
  });
  if (!span) return;
  if (failed) endSpanWithError(span, outcome.error);
  else span.end();
}

/**
 * The lifecycle SSE and WebSocket share. `connect()` opens the connection; a failure is recorded and
 * rethrown. A connection that opened is observed until its `closed` settles, which
 * {@link finishConnection} records once: `outcomeOf` maps a fulfilled close, a rejection is an
 * error.
 */
export function observeConnection<
  THandle extends { readonly closed: Promise<TClosed> },
  TClosed,
>(
  transport: "sse" | "websocket",
  options: ClientCallOptions<THandle, ConnectionClientMetrics>,
  call: ClientCall,
  req: HttpRequest,
  connect: () => Promise<THandle>,
  outcomeOf: (closed: TClosed) => Outcome,
): Promise<THandle> {
  const { span } = call;
  const { logger, metrics, responseHook } = options;
  const connectStartMs = performance.now();

  // With a client span, the rest of the chain runs with it active.
  return (span ? context.with(call.context, connect) : connect()).then(
    (handle) => {
      const connectedAtMs = performance.now();

      if (span) {
        if (responseHook) {
          runSpanHook(span, "responseHook", () =>
            responseHook(span, handle, req),
          );
        }
        span.addEvent(`${transport}.connected`);
      }
      metrics?.connectDuration.record(
        durationSeconds(connectStartMs, connectedAtMs),
        { ...call.attributes, "defjs.result": "success" },
      );
      metrics?.active.add(1, call.attributes);

      const record: ConnectionRecord = {
        transport,
        call,
        logger,
        metrics,
        signal: req.signal,
        connectedAtMs,
      };
      handle.closed.then(
        (closed) => finishConnection(record, outcomeOf(closed)),
        (error: unknown) => finishConnection(record, { end: "error", error }),
      );
      return handle;
    },
    (error: unknown): never => {
      const durationS = durationSeconds(connectStartMs);
      const attributes: Attributes = { ...call.attributes };
      if (isCallerCancellation(req.signal, error)) {
        attributes["defjs.result"] = "aborted";
        if (span) endSpanAborted(span, transport);
      } else {
        emitClientException(logger, {
          transport,
          phase: "connect",
          context: call.context,
          error,
          attributes: call.attributes,
          meta: call.meta,
        });
        attributes["defjs.result"] = "error";
        attributes["error.type"] = getErrorType(error);
        if (span) endSpanWithError(span, error);
      }
      metrics?.connectDuration.record(durationS, attributes);
      throw error;
    },
  );
}
