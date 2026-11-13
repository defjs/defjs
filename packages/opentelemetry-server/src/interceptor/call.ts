import type { HttpRequest } from "@defjs/core";
import type {
  Attributes,
  Context,
  Span,
  TextMapPropagator,
  Tracer,
} from "@opentelemetry/api";
import { context, SpanKind, trace } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import type { OpenTelemetryServerTransportOptions } from "../option";
import { headersGetter } from "../propagation/carrier";
import {
  normalizeHttpMethod,
  recordSpanHookError,
  runSpanHook,
} from "../telemetry/trace";
import type { ResolvedUrl } from "../telemetry/url";
import { redactEndpoint, serverAttributes } from "../telemetry/url";

/** What the interceptor of every transport is built from. */
export interface ClientCallOptions<
  TResponse,
  TMetrics,
> extends OpenTelemetryServerTransportOptions<TResponse> {
  tracer?: Tracer;
  logger?: Logger;
  propagator: TextMapPropagator;
  metrics?: TMetrics;
  requireParentSpan?: boolean;
}

/** One outbound call as its telemetry sees it. */
export interface ClientCall {
  /** The client span; absent without a tracer. */
  span: Span | undefined;
  /** The extracted parent context, carrying the client span when there is one. */
  context: Context;
  /** `server.address` and `server.port`: what the span, metrics and logs share. */
  attributes: Attributes;
  /** The request's `meta` as `defjs.meta.<key>` attributes, for the span and logs but not metrics. */
  meta: Attributes;
  /** The normalized `http.request.method`; as given when nothing observes the call, because nothing reads it then. */
  method: string;
}

/** The options as the shared code reads them: the response type only sets the hook's parameter and `never` accepts every transport's, and `unknown` accepts every transport's metrics. */
type AnyClientCallOptions = ClientCallOptions<never, unknown>;

const NO_ATTRIBUTES: Attributes = Object.freeze({});

/** `requireParentSpan` applies only with a tracer: without one there is no span to parent. */
export function requiresActiveSpan(options: AnyClientCallOptions): boolean {
  return options.tracer !== undefined && options.requireParentSpan === true;
}

/**
 * Extracts the parent context and, with a tracer, starts the client span and runs `startSpanHook`
 * and `requestHook`.
 *
 * `method` is the request method as given. The span is named `name`, or by the HTTP convention
 * when `name` is omitted: the normalized method, and `HTTP` when that is `_OTHER`.
 */
export function startClientCall(
  options: AnyClientCallOptions,
  req: HttpRequest,
  resolve: (endpoint: string, baseEndpoint?: string) => ResolvedUrl,
  method: string,
  name?: string,
): ClientCall {
  const { tracer, startSpanHook, requestHook } = options;
  const parent = options.propagator.extract(
    context.active(),
    req.headers ?? new Headers(),
    headersGetter,
  );
  // PERF: a call that no tracer, meter or logger observes only propagates. Resolving its URL
  // anyway was about 70% of that path (HTTP with options `{}`: 940 ns/op resolved, 250 ns/op not).
  if (!tracer && !options.metrics && !options.logger) {
    return {
      span: undefined,
      context: parent,
      attributes: NO_ATTRIBUTES,
      meta: NO_ATTRIBUTES,
      method,
    };
  }

  const resolved = resolve(req.endpoint, req.baseEndpoint);
  const attributes = serverAttributes(resolved);
  const normalized = normalizeHttpMethod(method);
  const meta =
    req.meta && (tracer || options.logger)
      ? metaAttributes(req.meta)
      : NO_ATTRIBUTES;
  if (!tracer) {
    return {
      span: undefined,
      context: parent,
      attributes,
      meta,
      method: normalized,
    };
  }

  // PERF: one spread, then assignments. A spread per attribute group took about 57 ns, this 26 ns.
  const spanAttributes: Attributes = {
    ...attributes,
    ...meta,
    "http.request.method": normalized,
    "url.full": resolved.url,
  };
  if (normalized !== method) {
    spanAttributes["http.request.method_original"] = method;
  }
  let hookFailure: { error: unknown } | undefined;
  if (startSpanHook) {
    try {
      const hookAttributes = startSpanHook(req);
      Object.assign(spanAttributes, hookAttributes);
      // The hook's attributes are applied last, so a `url.full` it returns replaces the redacted
      // one and goes through the same redaction.
      const url = hookAttributes["url.full"];
      if (typeof url === "string") {
        spanAttributes["url.full"] = redactEndpoint(url);
      }
    } catch (error) {
      hookFailure = { error };
    }
  }
  const spanName = name ?? (normalized === "_OTHER" ? "HTTP" : normalized);
  const span = tracer.startSpan(
    spanName,
    { kind: SpanKind.CLIENT, attributes: spanAttributes },
    parent,
  );
  if (hookFailure) {
    recordSpanHookError(span, "startSpanHook", hookFailure.error);
  }
  if (requestHook) {
    runSpanHook(span, "requestHook", () => requestHook(span, req));
  }
  return {
    span,
    context: trace.setSpan(parent, span),
    attributes,
    meta,
    method: normalized,
  };
}

/**
 * Each own enumerable key of `meta` becomes `defjs.meta.<key>` with its value as given. Attribute
 * values are OpenTelemetry `AnyValue`; the SDK decides which values it keeps, as it does for any
 * attribute. An empty `meta` adds nothing.
 */
function metaAttributes(meta: { readonly [key: string]: unknown }): Attributes {
  const attributes: Attributes = {};
  for (const key of Object.keys(meta)) {
    attributes[`defjs.meta.${key}`] = meta[key];
  }
  return attributes;
}
