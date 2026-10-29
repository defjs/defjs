# @defjs/opentelemetry-server

Server-side outbound OpenTelemetry integration for `@defjs/core` HTTP, SSE, and WebSocket clients. It is a middleware plugin: the plugin form of an interceptor chain.

Instrument a consuming application's client while keeping its imported SDK definitions independent of telemetry configuration. The application owns providers, exporters, and shutdown; the API SDK continues to export reusable operations. References to the OpenTelemetry SDK below mean the telemetry runtime, not the API SDK built with Defjs.

**Core Positioning**:

- **Outbound-only client instrumentation** — This package wraps defjs clients that make outbound requests. It is not inbound server instrumentation.
- **Server environment** — Designed for server-side applications with an OpenTelemetry SDK, not browser-only telemetry setup.
- **Does not initialize the SDK** — Configure your application's providers, then pass optional `tracer`, `meter`, and `logger` instances into `withOpenTelemetryServer(...)`. The signals work independently. It never obtains a tracer or logger implicitly. API objects without a configured provider are silent no-ops.
- **Per-transport separation** — HTTP, SSE, and WebSocket each have independent interceptors, span lifecycles, and metric dimensions.

## Installation

Install `@defjs/opentelemetry-server` with the matching `@defjs/core` release line and its OpenTelemetry peers:

```sh
bun add @defjs/core @defjs/opentelemetry-server @opentelemetry/api @opentelemetry/core
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.4.0` range. Its tarball retains this `README.md` and the repository `LICENSE`; repository-wide guides and examples remain outside the package.

The native Logs API (`@opentelemetry/api-logs`) is a regular dependency, so existing consumers do not need another peer. Install SDKs, exporters, and third-party logging bridges in your application when needed. The package consumes the optional tracer, meter, and logger you pass; it does not emit spans without a tracer or logs without a logger.

## Basic Usage

For tracing, this package does not install a `TracerProvider`. `trace.getTracer('my-service')` without `trace.setGlobalTracerProvider(...)` (your SDK's `start()` usually does this) returns a no-op tracer: interceptors still wrap requests, but spans are silently discarded. Pass a recording tracer from your SDK, or register the provider first:

```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { trace } from "@opentelemetry/api";

// After your OpenTelemetry SDK has called setGlobalTracerProvider:
const tracer = trace.getTracer("my-service");

const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({
    tracer,
  }),
);
```

### Metrics without local spans

Omit `tracer` to record metrics without local spans. The plugin never calls `trace.getTracer(...)` and does not invoke `startSpanHook`, `requestHook`, or `responseHook` in this mode. Initialize your application's OpenTelemetry SDK with a `MeterProvider` separately, then pass its meter:

```typescript
import { createClient, defineRequest, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("my-service");
const readOrders = defineRequest({
  method: "GET",
  operation: "orders.read",
  path: "/orders",
});

const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({ meter }),
);

const [error] = await client.execute(readOrders());
if (error) console.error(error.code);
```

Context propagation still forwards the extracted parent context without a local span; WebSocket `queryPropagation` still defaults to `false`. With a `tracer`, `requireParentSpan: true` bypasses spans, propagation, hooks, metrics, and logs when no active parent exists. Without a `tracer`, it blocks neither metrics nor logs.

### Logs and third-party loggers

`logger` accepts the native `Logger` from `@opentelemetry/api-logs`. Pass one from your application's provider; a Winston or Pino business logger is a different interface. Logger-only usage does not create local spans:

```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
  ConsoleLogRecordExporter,
} from "@opentelemetry/sdk-logs";

const provider = new LoggerProvider({
  processors: [
    new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() }),
  ],
});
const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({
    logger: provider.getLogger("@defjs/opentelemetry-server"),
  }),
);
// Use client, finish pending requests and streams, then await provider.shutdown().
```

Defjs emits at most one diagnostic per request or logical connection, always `WARN` / 13:

| Outcome                                                                     | Event / phase                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| HTTP `next()` rejects, excluding cancellation and public HTTP_STATUS faults | `http.client.request.exception` / `request`                                    |
| SSE or WebSocket connection fails                                           | `defjs.client.sse.exception` or `defjs.client.websocket.exception` / `connect` |
| SSE or WebSocket ends in error, including a rejected `closed`               | Same transport event / `connection`                                            |

Successful responses, HTTP status responses (including 4xx/5xx whose declared `error` body decodes), normal closure, EOF, and caller cancellation produce no LogRecord. An HTTP execute timeout logs once only when this interceptor observes its `next()` reject in the chain / transport. An abort whose reason is a `TimeoutError` (for example `AbortSignal.timeout()`) is classified as a timeout, not a cancellation, but the same observation boundary applies. Timeouts during input parsing, the builder, interceptor work after `await next()`, or declared-body conversion after the chain need outer command-level observation; they do not necessarily produce a transport LogRecord.

Core reads a declared `output` (2xx) or `error` (other status) body inside the HTTP interceptor chain. A read failure in any representation makes `next()` reject with an internal `BodyFailure`. Only JSON representation checks for a JSON media type and JSON-parses the body; a failure there also rejects with `BodyFailure`. These rejections emit one HTTP record whatever the status, and the command returns `NET_BODY_INCOMPLETE`, `RES_MEDIA_TYPE_INVALID`, or `RES_DECODE_FAILED`. Text, blob, and bytes representations accept normal non-JSON bodies without logging. A body that is not declared is never read and cannot log. HTTP Struct validation (`RES_STRUCT_MISMATCH`), an absent declared body such as a 204, and the later HTTP_STATUS conversion happen after the interceptor and do not log.

An SSE non-2xx handshake is observed as a connection failure and logs once. If its declared `error` body decodes, Core returns `HTTP_STATUS`; if that body fails its Struct, Core returns `RES_DECODE_FAILED` with a `StructError` cause, not `RES_STRUCT_MISMATCH`. A WebSocket close frame from the server (any code, for example 1000 or 1011) resolves as a normal close and produces no LogRecord. An abrupt drop without a close frame (code 1006) depends on the runtime: where the platform WebSocket reports a socket `error` before `close` (Node.js), the session ends in error and logs one WARN with `websocket.close.code` `1006`; where it does not (Bun), the drop resolves as a normal close and nothing is logged. Otherwise only a session that ends in error, such as an incoming queue overflow or a heartbeat timeout, logs. Command input validation, individual messages, reconnect attempts, and hook failures do not produce extra Logs. The HTTP exception convention is currently Development; SSE/WS names are Defjs-specific.

`exception.type` is the class name of what the interceptor observed, not a Defjs fault code. It can be an internal class (`BodyFailure` for an HTTP body, `EventStreamFatalError` for an SSE handshake, `DefjsFault` for a WebSocket startup failure) or a platform class such as `TypeError` for a network failure and `Error` for a timeout.

Diagnostics contain a fixed message, exception type, phase, static operation, available server address/port, and protocol fields. They do not copy raw URLs, query strings, headers, bodies, baggage, close reasons, error messages/stacks, or hook attributes. Keep custom operation and exception names non-sensitive. Each record explicitly uses the saved outbound context, including asynchronous closure; span sampling does not suppress these logs. Logging failures cannot replace the business result.

For third-party business logging, connect the library to the same application's Logs pipeline:

- **Winston:** register the Logs provider, create `OpenTelemetryTransportV3`, and inject a native Logger into Defjs. The transport resolves the global provider lazily, so registration only has to happen before the first record is logged; earlier records are dropped. Use the explicit transport or automatic log sending once, to avoid duplicates.
- **Pino on Node.js:** start the SDK with `PinoInstrumentation` before loading Pino. Log correlation and log sending are separate features. A Pino worker transport can have a separate provider.
- **Levels:** OTel TRACE/DEBUG/INFO/WARN/ERROR/FATAL use base values 1/5/9/13/17/21. Bridge mappings convert the library's levels; its numeric levels are not OTel severity numbers. A Winston transport threshold does not filter Defjs's direct Logger; use a shared processor or Collector for a common policy.

See the [complete integration guide](https://github.com/defjs/defjs/blob/main/doc/content/en-US/docs/integrations/opentelemetry-server.mdx#logs-and-third-party-loggers) for mappings and Pino initialization order. The [runnable Winston example](https://github.com/defjs/defjs/tree/main/doc/examples/opentelemetry-logging) uses a real Logs SDK, demonstrates DEBUG console output versus INFO OTel output, and closes its resources. In this repository, run `bun doc/examples/opentelemetry-logging/winston.ts`.

## Operation Identity

Set the optional `operation` field statically on `defineRequest(...)`, `defineEventStream(...)`, or `defineWebSocket(...)`:

```typescript
const readOrder = defineRequest({
  method: "GET",
  operation: "orders.read",
  path: "/orders/:id",
  // input and output omitted
});
```

An explicit operation is the low-cardinality transport identity. HTTP spans use names such as `GET orders.read`; SSE and WebSocket spans use `SSE orders.watch` and `WebSocket orders.connect`. Spans and metrics also receive `defjs.operation`.

Without `operation`, the previous fallback remains unchanged: HTTP uses the request method as its span name, SSE uses `SSE`, WebSocket uses `WebSocket`, and `defjs.operation` is omitted. Never infer an operation from `req.endpoint`, a resolved URL, or a path containing identifiers. Do not copy resolved URLs into custom attributes or logs.

## Full Configuration

```typescript
const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({
    tracer, // Optional, local spans and span hooks only run when provided
    meter, // Optional, metrics only collected when provided
    logger, // Optional native OTel Logger, failure diagnostics only
    propagator, // Optional, default W3C TraceContext + Baggage
    requireParentSpan: false,
    http: {
      enabled: true,
      startSpanHook(req) {
        return { "app.operation": req.operation ?? "unclassified" };
      },
      responseHook(span, res, req) {
        span.setAttribute("defjs.response.status_text", res.statusText);
      },
    },
    sse: {
      enabled: true,
    },
    webSocket: {
      enabled: true,
      queryPropagation: false, // Safe default; set true only after reviewing URL propagation
    },
  }),
);
```

## WebSocket propagation safety

`webSocket.queryPropagation` defaults to `false`. Omitting it leaves the WebSocket query string unchanged and does not inject trace context or baggage into the URL.

Browser WebSocket clients usually cannot set arbitrary headers. If you have reviewed URL-based propagation for your environment and accept its exposure boundary, enable it explicitly:

```ts
withOpenTelemetryServer({
  tracer,
  webSocket: {
    queryPropagation: true,
  },
});
```

Injected fields are written to the end of the query string and replace any parameter of the same name. All other parameters keep their serialized form, including a propagation parameter the propagator has nothing to inject for.

Query strings can be recorded by proxies, browsers, APM tooling, access logs, and network debugging tools. They may also contain tokens or other high-cardinality user input. If your propagator includes `baggage`, baggage values can also be written into the URL and may contain sensitive data.

With the safe default, trace context does not ride on the WebSocket URL. Use another reviewed correlation mechanism at the application layer, such as a protocol-reviewed first frame or a short-lived connection ticket, if your server still needs to link the connection to a trace.

### Configuration Options

| Option              | Type                                    | Default                    | Description                                                                                                  |
| ------------------- | --------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tracer`            | `Tracer`                                | `undefined`                | External OpenTelemetry tracer; omitting disables local spans and span hooks                                  |
| `meter`             | `Meter`                                 | `undefined`                | External OpenTelemetry meter, omitting disables metrics                                                      |
| `logger`            | `Logger` from `@opentelemetry/api-logs` | `undefined`                | External native Logger; omitting disables diagnostic LogRecords                                              |
| `propagator`        | `TextMapPropagator`                     | W3C TraceContext + Baggage | Custom context propagator                                                                                    |
| `requireParentSpan` | `boolean`                               | `false`                    | With a tracer, bypass all instrumentation when no active parent exists; does not block logger/meter-only use |
| `http`              | `OpenTelemetryServerHttpOptions`        | `{}`                       | HTTP transport trace/metric options                                                                          |
| `sse`               | `OpenTelemetryServerSSEOptions`         | `{}`                       | SSE transport trace/metric options                                                                           |
| `webSocket`         | `OpenTelemetryServerWebSocketOptions`   | `{}`                       | WebSocket transport trace/metric options                                                                     |

### HTTP Options

| Option          | Type                                        | Default     | Description                                                                    |
| --------------- | ------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `enabled`       | `boolean`                                   | `true`      | Enable HTTP instrumentation                                                    |
| `startSpanHook` | `(req) => Attributes`                       | `undefined` | Add or override synchronous initial attributes before the HTTP span is created |
| `requestHook`   | `(span, req) => void \| Promise<void>`      | `undefined` | Customize HTTP span before request, `req` is `HttpRequest`                     |
| `responseHook`  | `(span, res, req) => void \| Promise<void>` | `undefined` | Customize HTTP span after response; `req` is the original `HttpRequest`        |

### SSE Options

| Option          | Type                                           | Default     | Description                                                                          |
| --------------- | ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `enabled`       | `boolean`                                      | `true`      | Enable SSE instrumentation                                                           |
| `startSpanHook` | `(req) => Attributes`                          | `undefined` | Add or override synchronous initial attributes before the SSE span is created        |
| `requestHook`   | `(span, req) => void \| Promise<void>`         | `undefined` | Customize SSE span before stream request                                             |
| `responseHook`  | `(span, stream, req) => void \| Promise<void>` | `undefined` | Customize SSE span after stream handle returned; `req` is the original `HttpRequest` |

### WebSocket Options

| Option             | Type                                            | Default     | Description                                                                                                                         |
| ------------------ | ----------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`          | `boolean`                                       | `true`      | Enable WebSocket instrumentation                                                                                                    |
| `queryPropagation` | `boolean`                                       | `false`     | Inject trace context and baggage into the WebSocket URL query string. Enable only after reviewing URL logging and disclosure risks. |
| `startSpanHook`    | `(req) => Attributes`                           | `undefined` | Add or override synchronous initial attributes before the WebSocket span is created                                                 |
| `requestHook`      | `(span, req) => void \| Promise<void>`          | `undefined` | Customize WebSocket span before connection request                                                                                  |
| `responseHook`     | `(span, session, req) => void \| Promise<void>` | `undefined` | Customize WebSocket span after session returned; `req` is the original `HttpRequest`                                                |

> **Hook timing and failures**: Span hooks run only when a `tracer` is supplied. `startSpanHook(request)` is synchronous and runs before span creation. Its attributes are applied after built-in attributes. If it throws, Defjs creates the span with built-in attributes and the client request/stream/session continues normally. `requestHook` and `responseHook` run after creation and may return `void` or `Promise<void>`; neither is awaited, and their throws/rejections do not block or fail the operation. While `span.isRecording()` is true, hook failures record `defjs.otel.hook.error` and `exception` events. For non-recording spans (ended or unsampled), failures go through `diag.error` with a fixed message and `hook.name`, `error.type`, `traceId`, and `spanId`; error messages, stacks, and request data are not included. Applications must configure `diag.setLogger(...)` from `@opentelemetry/api` to receive these diagnostics; there is no automatic output by default. This package does not initialize the SDK, and this diagnostic is not a separate SDK `LogRecord`. This diagnostic includes `hook.name`, `error.type`, `traceId`, and `spanId`, but excludes the original error message or stack and request data.
>
> The HTTP span ends when the synchronous part of `responseHook` returns and is not extended for an asynchronous hook. The synchronous part can still modify a recording span; events cannot be appended after it ends. A later hook rejection uses the diagnostic logger described above.
>
> Each `responseHook` receives the original transport `HttpRequest` as its third argument. Read its explicit `operation`; do not reconstruct identity from its endpoint or a resolved URL.
>
> **Attribute hygiene**: This package has no built-in redactor or sensitive-key policy. Prefer explicit allowlists, application-owned redaction, and stable low-cardinality attributes in hooks. Do not attach resolved URLs, raw query strings, request or response bodies, full headers, baggage values, or message payloads unless your application has already reviewed privacy, cardinality, retention, and redaction requirements.

## HTTP Semantic Conventions and Metrics

HTTP tracing uses stable OpenTelemetry HTTP client attribute and metric names. This is not a claim of complete semantic-convention compliance. With an explicit operation, the interceptor creates a `SpanKind.CLIENT` span named `${method} ${operation}` and records `defjs.operation`. Without one, it preserves the previous method-only span name and omits that attribute. It also records:

- `http.request.method`
- `url.full`
- `server.address`
- Optional `server.port` — only when the URL has an explicit non-default port
- `http.response.status_code` only when a response status was received

HTTP span status and `error.type` follow these rules:

- status `100` through `399` leaves span status unset and does not set `error.type`;
- status `400` and above marks the client span `ERROR` and sets `error.type` to the status code string;
- a rejection produces no response, so `http.response.status_code` stays unset. This covers a network failure, caller cancellation, a timeout, and a declared-body read or parse failure;
- an error thrown through the interceptor marks the span `ERROR`, records the exception, and uses its `Error.name` or another low-cardinality type fallback as `error.type`. That is `TypeError` for a typical network failure, `Error` for caller cancellation (whatever the abort reason) and for a timeout, and `BodyFailure` for a body failure. It is never a `NET_*` or `RES_*` fault code, because Core classifies faults after the interceptor chain. Cancellation is therefore also an `ERROR` span (it only skips the log).

In the current implementation, `url.full` is resolved from `req.endpoint` and the optional `req.baseEndpoint`; it does not append `req.queryString`. This is an implementation boundary, not sanitization, an identity source, or a guarantee that URLs are safe. Applications that need a complete or redacted URL can override the initial value explicitly:

```ts
import { createResolvedRequestUrl } from "@defjs/core";

withOpenTelemetryServer({
  tracer,
  http: {
    startSpanHook(req) {
      if (!req.baseEndpoint) return {};
      const url = createResolvedRequestUrl(req.baseEndpoint, req.endpoint);
      if (req.queryString) url.search = req.queryString;
      url.searchParams.delete("access_token");
      return { "url.full": url.href };
    },
  },
});
```

Resolved paths can contain sensitive or high-cardinality identifiers. Keep operation names static and apply application or SDK/exporter redaction before exporting URL attributes.

When `meter` is provided, the following stable metrics are collected:

| Metric                         | Unit | Attributes                                                                                                                                                                                    |
| ------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http.client.request.duration` | `s`  | `http.request.method`, optional `defjs.operation`, `server.address`, optional `server.port` (explicit non-default URL port only), optional `http.response.status_code`, optional `error.type` |

The metric applies the same response-status and `error.type` classification as the HTTP span.

### Transport span boundary

The HTTP span ends when the interceptor receives the Defjs `HttpResponse`. For a declared `output` or `error` body, the transport reads the selected JSON, text, blob, or bytes representation before returning that response. Only JSON representation checks the JSON media type and JSON-parses the body. A read failure in any representation, or a JSON media-type / parse failure (`NET_BODY_INCOMPLETE`, `RES_MEDIA_TYPE_INVALID`, or `RES_DECODE_FAILED`), rejects through the interceptor, so the span ends `ERROR` with `error.type` `BodyFailure` and no `http.response.status_code`, whatever the HTTP status. HTTP Struct validation (`RES_STRUCT_MISMATCH`), an absent declared body, and the conversion of a non-2xx response into `HTTP_STATUS` happen afterward and cannot update that transport span.

When telemetry must represent the final command outcome, create an application span around `client.execute(...)` and classify the returned tuple:

```ts
import { SpanStatusCode } from "@opentelemetry/api";

const outcome = await tracer.startActiveSpan("defjs.command", async (span) => {
  try {
    const outcome = await client.execute(command);
    const [error] = outcome;
    if (error) {
      span.setAttribute("error.type", error.code);
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    return outcome;
  } catch (error) {
    span.setAttribute(
      "error.type",
      error instanceof Error ? error.name : typeof error,
    );
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
});
```

This outer span is application-owned command telemetry; the plugin continues to emit only its lower-level transport span.

This package does not add request or response bodies, full headers, baggage values, payload sizes, or message payloads as default custom telemetry fields. It also does not create separate span attributes or metrics for raw query strings.

Do not add raw query strings, request or response bodies, full headers, baggage values, or message payloads to spans or metrics unless the application has reviewed privacy, cardinality, retention, and redaction requirements. Prefer explicit allowlists, redaction, and stable low-cardinality attributes when extending telemetry with hooks.

## SSE Connection-Level Tracing and Custom Metrics

SSE is a long-lived HTTP response. Normal HTTP request duration ends at stream establishment, which does not reflect whether the stream is still running, interrupted, or errored. Therefore, this package treats SSE as **connection-level** telemetry.

### Span Lifecycle

After startup succeeds, the SSE interceptor attaches to `stream.closed` and keeps the span open until the stream reaches its normal, fatal, or aborted terminal state. It records:

- `sse.connected` — Stream successfully established
- `sse.closed` — Stream normal end (server EOF)
- `sse.aborted` — Active close via `stream.close()` or a caller abort of the open stream; the span still ends without error
- `sse.error` — Connection error or reconnect exhaustion

### Custom Metrics

When `meter` is provided, the following defjs custom metrics are collected (non-official OpenTelemetry stable semantic conventions):

| Metric                                 | Unit       | Meaning                                                 |
| -------------------------------------- | ---------- | ------------------------------------------------------- |
| `defjs.client.sse.connect.duration`    | `s`        | Time to establish stream connection                     |
| `defjs.client.sse.connection.duration` | `s`        | Total duration from stream establishment to close/error |
| `defjs.client.sse.active_streams`      | `{stream}` | Current active SSE stream count                         |

By default, **per-event spans are not created**, and **event payloads, event IDs, `Last-Event-ID`, delivery latency, lost events, or reconnect queues are not collected**. These are application-level semantics that may produce high-cardinality or sensitive telemetry. Implement them at the application layer if needed.

## WebSocket Connection-Level Tracing and Custom Metrics

WebSocket starts with an HTTP Upgrade handshake, but production environments care more about the post-handshake connection lifecycle: active connections, connection duration, close/error behavior, and connection failure rate. Since OpenTelemetry WebSocket semantic conventions are not yet stable, this package uses connection-level custom metrics.

### Span Lifecycle

The WebSocket span stays open until `session.closed` resolves, recording the following lifecycle events:

- `websocket.connected` — Session successfully established
- `websocket.closed` — Connection normal close. A close frame from the server counts as normal whatever its code, including 1011. An abrupt drop (1006) is normal only where the runtime reports no socket `error` before `close` (Bun); where it does (Node.js), the session ends in error instead
- `websocket.error` — Connection error, or a caller abort of an open session. The span ends `ERROR`. A connection error emits one Log; a caller abort emits none. After an abort, `error.type` follows the abort reason: its `Error.name` (`AbortError` for a default `abort()`, `Error` for a plain `Error` or a `null` reason), or its `typeof` (`string`) for a non-Error reason. An abort while the WebSocket is still connecting ends the span `ERROR` with `error.type` `DefjsFault`

### Custom Metrics

When `meter` is provided, the following defjs custom metrics are collected:

| Metric                                       | Unit           | Meaning                                                  |
| -------------------------------------------- | -------------- | -------------------------------------------------------- |
| `defjs.client.websocket.connect.duration`    | `s`            | Time to establish WebSocket session                      |
| `defjs.client.websocket.connection.duration` | `s`            | Total duration from session establishment to close/error |
| `defjs.client.websocket.active_connections`  | `{connection}` | Current active WebSocket connection count                |

By default, **per-message spans are not created**, and **message payloads, message sizes, backpressure, buffered amount, subprotocols, or reconnect queues are not collected**. Keep any application-layer message telemetry opt-in, sampled, redacted, and limited to stable low-cardinality attributes whenever possible.

## What's Next

- [OpenTelemetry guide](https://defjs.lyz.cloud/docs/integrations/opentelemetry-server) — complete plugin boundaries and examples
- [Client](https://defjs.lyz.cloud/docs/client) — `createClient` and full transport configuration
- [SSE](https://defjs.lyz.cloud/docs/sse) — `defineEventStream` and streaming event consumption
- [WebSocket](https://defjs.lyz.cloud/docs/web-socket) — `defineWebSocket` and real-time communication
