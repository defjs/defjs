import type { WebSocketCloseInfo, WebSocketSessionLike } from "@defjs/core";
import { createWebSocketInterceptor } from "@defjs/core";
import { trace } from "@opentelemetry/api";
import { carrierSetter } from "../propagation/carrier";
import type { ConnectionClientMetrics } from "../telemetry/metrics";
import { resolveWebSocketUrl } from "../telemetry/url";
import type { ClientCallOptions } from "./call";
import { requiresActiveSpan, startClientCall } from "./call";
import type { Outcome } from "./connection";
import { observeConnection } from "./connection";

export interface WebSocketInterceptorOptions extends ClientCallOptions<
  WebSocketSessionLike,
  ConnectionClientMetrics
> {
  queryPropagation?: boolean;
}

function webSocketOutcome(info: WebSocketCloseInfo): Outcome {
  if (info.kind === "closed") return { end: "closed" };
  if (info.kind === "aborted") return { end: "aborted" };
  return {
    end: "error",
    error: info.cause,
    extra:
      info.code === undefined
        ? undefined
        : { "websocket.close.code": info.code },
  };
}

export function createOpenTelemetryWebSocketInterceptor(
  options: WebSocketInterceptorOptions,
): ReturnType<typeof createWebSocketInterceptor> {
  const { propagator, queryPropagation } = options;
  const needsActiveSpan = requiresActiveSpan(options);

  return createWebSocketInterceptor(async (req, next) => {
    if (needsActiveSpan && !trace.getActiveSpan()) {
      return next(req);
    }

    // The opening handshake is always a GET (RFC 6455 section 4.1).
    const call = startClientCall(
      options,
      req,
      resolveWebSocketUrl,
      "GET",
      "WebSocket",
    );

    let query = req.query;

    if (queryPropagation) {
      // Every caller pair with an injected name is removed and the injected pairs are appended, so the receiver sees
      // only the injected value. The caller's own query is left as it was.
      const injected = new URLSearchParams();
      propagator.inject(call.context, injected, carrierSetter);
      query = new URLSearchParams(req.query);
      for (const name of injected.keys()) {
        query.delete(name);
      }
      for (const [name, value] of injected) {
        query.append(name, value);
      }
    }

    return observeConnection(
      "websocket",
      options,
      call,
      req,
      () => next({ ...req, query }),
      webSocketOutcome,
    );
  });
}
