# @defjs/opentelemetry-server

Server-side outbound OpenTelemetry for `@defjs/core` HTTP, SSE, and WebSocket clients.

It is a middleware plugin — the plugin form of an interceptor chain. Your application keeps its OpenTelemetry SDK, providers, exporters, and shutdown; the imported SDK definitions stay free of telemetry configuration. This package is outbound client instrumentation for server applications, not inbound server instrumentation.

## Install

```sh
bun add @defjs/core @defjs/opentelemetry-server @opentelemetry/api @opentelemetry/core
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.4.0` range.

## Quick start

It never initializes a provider or looks one up implicitly: pass the `tracer`, `meter`, and `logger` you want, and each signal works independently. Without a `tracer` no spans are created — interceptors still wrap requests, but `trace.getTracer()` returns a no-op until your SDK registers a provider.

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

Omit `tracer` to record metrics only; the plugin then never calls `trace.getTracer(...)` or the span hooks. `logger` accepts the native `Logger` from `@opentelemetry/api-logs`, not a Winston or Pino business logger.

```typescript
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("my-service");

const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({ meter }),
);
```

## Operation identity

Set `operation` statically on the definition. It is the low-cardinality transport identity: spans are named `GET orders.read`, `SSE orders.watch`, `WebSocket orders.connect`, and `defjs.operation` is recorded on spans and metrics.

```typescript
const readOrder = defineRequest({
  method: "GET",
  operation: "orders.read",
  path: "/orders/:id",
});
```

Without it, HTTP spans use the method alone and SSE/WebSocket use their transport name. Never derive an operation from a resolved URL or a path containing identifiers.

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
| `tracer`            | `Tracer`                                | `undefined`                | External tracer; omitting disables local spans and hooks                    |
| `meter`             | `Meter`                                 | `undefined`                | External meter; omitting disables metrics                                   |
| `logger`            | `Logger` from `@opentelemetry/api-logs` | `undefined`                | External native Logger; omitting disables diagnostic LogRecords             |
| `propagator`        | `TextMapPropagator`                     | W3C TraceContext + Baggage | Custom context propagator                                                   |
| `requireParentSpan` | `boolean`                               | `false`                    | With a tracer, bypass all instrumentation when no active parent span exists |
| `http`              | `OpenTelemetryServerHttpOptions`        | `{}`                       | HTTP transport options                                                      |
| `sse`               | `OpenTelemetryServerSSEOptions`         | `{}`                       | SSE transport options                                                       |
| `webSocket`         | `OpenTelemetryServerWebSocketOptions`   | `{}`                       | WebSocket transport options                                                 |

Span hooks run only with a `tracer`. `startSpanHook(request)` is synchronous and runs before span creation; a throw leaves the built-in attributes and the operation continues. `requestHook` and `responseHook` are not awaited, and their failures never block or fail the operation. Configure `diag.setLogger(...)` to see hook diagnostics.

## Privacy defaults

- `webSocket.queryPropagation` defaults to `false`: trace context and baggage do not ride on the WebSocket URL. Enable it only after reviewing how your proxies, browsers, and access logs record query strings.
- No bodies, full headers, baggage values, or message payloads are added as telemetry fields, and no built-in redactor exists. Prefer allowlists and low-cardinality attributes in hooks.
- Diagnostics carry a fixed message, phase, operation, server address/port, and exception type — not raw URLs, headers, bodies, or stacks.
- SSE and WebSocket are traced per connection, not per event or message.

## Documentation

- [OpenTelemetry guide](https://defjs.lyz.cloud/docs/integrations/opentelemetry-server) — full option tables, log events, span lifecycles, metrics, and third-party logging
- [OpenTelemetry API](https://defjs.lyz.cloud/api/opentelemetry-server)
- [Client](https://defjs.lyz.cloud/docs/client) · [SSE](https://defjs.lyz.cloud/docs/sse) · [WebSocket](https://defjs.lyz.cloud/docs/web-socket)

## License

MIT.
