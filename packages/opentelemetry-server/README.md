# @defjs/opentelemetry-server

Server-side outbound OpenTelemetry for `@defjs/core` HTTP, SSE, and WebSocket clients.

It is a middleware plugin — the plugin form of an interceptor chain. Your application keeps its OpenTelemetry SDK, providers, exporters, and shutdown; the imported SDK definitions stay free of telemetry configuration. This package is outbound client instrumentation for server applications, not inbound server instrumentation.

## Install

```sh
bun add @defjs/core @defjs/opentelemetry-server @opentelemetry/api @opentelemetry/core
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.8.0` range.

## Quick start

It never initializes a provider or looks one up implicitly: pass the `tracer`, `meter`, and `logger` you want, and each signal works independently. Without a `tracer` the plugin creates no spans and never calls `trace.getTracer(...)`; propagation still forwards the extracted parent context.

```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { trace } from "@opentelemetry/api";

// After your OpenTelemetry SDK has called setGlobalTracerProvider:
const tracer = trace.getTracer("my-service");

const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({ tracer }),
);
```

Omit `tracer` to disable local spans and span hooks while still recording metrics, emitting logs, and propagating context. `logger` accepts the native `Logger` from `@opentelemetry/api-logs`, not a Winston or Pino business logger.

```typescript
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("my-service");

const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({ meter }),
);
```

## Definition `meta`

Each own enumerable key of a definition's `meta` becomes a `defjs.meta.<key>` attribute on the span and on failure logs, with its value as given; the OpenTelemetry SDK keeps or drops each value by its attribute rules. An absent or empty `meta` adds nothing, and metrics never carry it. Spans are named after the HTTP method (`HTTP` for `_OTHER`), `SSE`, or `WebSocket`.

```typescript
const getOrder = defineRequest({
  method: "GET",
  meta: { operation: "orders.get" },
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
});
// The span carries "defjs.meta.operation": "orders.get".
```

Attributes returned by `startSpanHook` are applied last and can replace a `defjs.meta.*` value on the span only; failure logs keep the value from `meta`. The SDK reports a dropped value only through `diag`. Keep values that should not leave the process out of `meta`.

## Configuration

```typescript
withOpenTelemetryServer({
  tracer, // optional: local spans and span hooks
  meter, // optional: metrics
  logger, // optional: failure diagnostics only
  propagator, // optional: defaults to W3C TraceContext + Baggage
  requireParentSpan: false,
  http: { enabled: true, startSpanHook, requestHook, responseHook },
  sse: { enabled: true, startSpanHook, requestHook, responseHook },
  webSocket: { enabled: true, queryPropagation: false },
});
```

| Option              | Type                                    | Default                    | Description                                                                 |
| ------------------- | --------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `tracer`            | `Tracer`                                | `undefined`                | External tracer; omitting disables local spans and span hooks               |
| `meter`             | `Meter`                                 | `undefined`                | External meter; omitting disables metrics                                   |
| `logger`            | `Logger` from `@opentelemetry/api-logs` | `undefined`                | External native Logger; omitting disables diagnostic LogRecords             |
| `propagator`        | `TextMapPropagator`                     | W3C TraceContext + Baggage | Custom context propagator                                                   |
| `requireParentSpan` | `boolean`                               | `false`                    | With a tracer, bypass all instrumentation when no active parent span exists |
| `http`              | `OpenTelemetryServerHttpOptions`        | omitted                    | HTTP transport options; omitting leaves the transport enabled               |
| `sse`               | `OpenTelemetryServerSSEOptions`         | omitted                    | SSE transport options; omitting leaves the transport enabled                |
| `webSocket`         | `OpenTelemetryServerWebSocketOptions`   | omitted                    | WebSocket transport options; omitting leaves the transport enabled          |

`withOpenTelemetryServer` reads `http`, `sse`, and `webSocket` once and keeps a field copy (`enabled`, the three span hooks, and WebSocket `queryPropagation`). A missing block stays missing, which leaves that transport enabled. Only `enabled: false` disables a transport, and that branch does not read the block's hooks or `queryPropagation`. Getters for the copied fields run during this call; a throw leaves the call and is not retried when the option is applied. Later changes to those blocks are ignored. `tracer`, `meter`, `logger`, `propagator`, and hook functions keep their identity.

The plugin calls the supplied Meter's instrument creation methods each time the option is applied to a client, not when the option is built. Instrument identity and aggregation remain under Meter/SDK control. Each duration histogram receives its own copy of the default bucket boundaries.

Span hooks run only with a `tracer`. `startSpanHook(request)` is synchronous and runs before span creation; a throw still creates the span with only its built-in attributes, and the operation continues. `requestHook` and `responseHook` are not awaited, and their failures never block or fail the operation. Configure `diag.setLogger(...)` to see hook diagnostics.

## Cancellation and timeouts

HTTP, SSE, and WebSocket follow one rule. A caller cancellation (an abort that is not a timeout) is not a failure: the span status stays unset, with no exception and no `error.type`, and the span records `http.aborted`, `sse.aborted`, or `websocket.aborted`. Duration metrics are still recorded, without `error.type`; the connection metrics carry `defjs.result` `aborted`. No log is emitted. A timeout, including `AbortSignal.timeout()`, stays a failure: the span ends `ERROR` and `error.type` is `timeout`.

## Privacy defaults

- `webSocket.queryPropagation` defaults to `false`: trace context and baggage do not ride on the WebSocket URL. Enable it only after reviewing how your proxies, browsers, and access logs record query strings.
- No bodies, full headers, baggage values, or message payloads are added as telemetry fields, and no built-in redactor exists beyond `url.full`, whose endpoint userinfo is replaced with `REDACTED:REDACTED` and whose default sensitive query values (`sig`, `X-Amz-Signature`, and the other keys in the semantic conventions) are replaced with `REDACTED`. Prefer allowlists and low-cardinality attributes in hooks.
- Diagnostics carry a fixed message, phase, server address/port, exception type, and the `defjs.meta.*` attributes — not raw URLs, headers, bodies, or stacks. Span `exception` events carry only `exception.type` for the same reason.
- SSE and WebSocket are traced per logical connection, not per event or message.

## Documentation

- [OpenTelemetry guide](https://defjs.lyz.cloud/docs/integrations/opentelemetry-server) — full option tables, log events, span lifecycles, metrics, and third-party logging
- [OpenTelemetry API](https://defjs.lyz.cloud/api/opentelemetry-server)
- [Client](https://defjs.lyz.cloud/docs/client) · [SSE](https://defjs.lyz.cloud/docs/sse) · [WebSocket](https://defjs.lyz.cloud/docs/web-socket)

## License

MIT.
