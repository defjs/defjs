import type { WebSocketCloseInfo, WebSocketSessionLike } from "@defjs/core";
import { createWebSocketInterceptor, ERR_ABORTED } from "@defjs/core";
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
  if (info.kind === "aborted") {
    return { end: "error", error: info.cause ?? ERR_ABORTED, quiet: true };
  }
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

    let queryParams = req.queryParams;
    let queryString = req.queryString;

    if (queryPropagation) {
      const injected = new URLSearchParams();
      propagator.inject(call.context, injected, carrierSetter);
      queryString = replaceInjectedPairs(
        queryString ?? new URLSearchParams(queryParams).toString(),
        injected,
      );
      queryParams = new URLSearchParams(queryString);
    }

    return observeConnection(
      "websocket",
      options,
      call,
      req,
      () => next({ ...req, queryParams, queryString }),
      webSocketOutcome,
    );
  });
}

/**
 * Put the injected pairs last and drop earlier pairs of the same name, so a receiver reading the first value gets the injected one.
 * Every other pair keeps the bytes it was serialized with.
 */
function replaceInjectedPairs(
  queryString: string,
  injected: URLSearchParams,
): string {
  const added = injected.toString();
  if (!added) return queryString;
  const prefixed = queryString.startsWith("?");
  const query = prefixed ? queryString.slice(1) : queryString;
  // Only the whole query has a '?' prefix. In a pair it is part of the key; '&' prevents stripping it.
  const kept = query
    ? query
        .split("&")
        .filter(
          (pair) =>
            !injected.has(
              new URLSearchParams(`&${pair}`).keys().next().value ?? "",
            ),
        )
    : [];
  const combined = [...kept, added].join("&");
  // A surviving literal '?' key may become first after filtering. Keep it separate from the query prefix.
  return prefixed || combined.startsWith("?") ? `?${combined}` : combined;
}
