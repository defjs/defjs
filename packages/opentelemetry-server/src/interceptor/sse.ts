import type { EventStreamCloseInfo, EventStreamHandle } from "@defjs/core";
import { createSSEInterceptor } from "@defjs/core";
import { trace } from "@opentelemetry/api";
import { carrierSetter } from "../propagation/carrier";
import type { ConnectionClientMetrics } from "../telemetry/metrics";
import { resolveHttpUrl } from "../telemetry/url";
import type { ClientCallOptions } from "./call";
import { requiresActiveSpan, startClientCall } from "./call";
import type { Outcome } from "./connection";
import { observeConnection } from "./connection";

export type SSEInterceptorOptions = ClientCallOptions<
  EventStreamHandle<unknown>,
  ConnectionClientMetrics
>;

function sseOutcome(info: EventStreamCloseInfo): Outcome {
  if (info.kind !== "error") {
    return {
      end: info.kind === "aborted" ? "aborted" : "closed",
      attributes: { "sse.close.kind": info.kind },
    };
  }
  const code = { "defjs.sse.fault.code": info.code };
  return {
    end: "error",
    error: info.cause,
    attributes: { "sse.close.kind": info.kind, ...code },
    extra: code,
  };
}

export function createOpenTelemetrySSEInterceptor(
  options: SSEInterceptorOptions,
): ReturnType<typeof createSSEInterceptor> {
  const { propagator } = options;
  const needsActiveSpan = requiresActiveSpan(options);

  return createSSEInterceptor(async (req, next) => {
    if (needsActiveSpan && !trace.getActiveSpan()) {
      return next(req);
    }

    const call = startClientCall(
      options,
      req,
      resolveHttpUrl,
      req.method,
      "SSE",
    );
    const headers = new Headers(req.headers);
    propagator.inject(call.context, headers, carrierSetter);

    return observeConnection(
      "sse",
      options,
      call,
      req,
      () => next({ ...req, headers }),
      sseOutcome,
    );
  });
}
