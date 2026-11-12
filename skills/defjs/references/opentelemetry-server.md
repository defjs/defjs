# OpenTelemetry server [#opentelemetry-server]

`@defjs/opentelemetry-server` instruments outbound HTTP, SSE, and WebSocket operations on a server application's client while keeping your SDK definitions completely independent of OpenTelemetry.

`withOpenTelemetryServer(options)` returns a `@defjs/core` [`ClientOption`](/api/core/clientoption-type) that appends one interceptor per enabled transport (HTTP, SSE, WebSocket). It does **not** initialize the OpenTelemetry SDK and does **not** instrument inbound server requests.

---

## 1. Basic setup & operation identity [#1-basic-setup--operation-identity]

Set a static, low-cardinality `operation` string on your SDK definitions (`defineRequest`, `defineEventStream`, `defineWebSocket`), then pass your OpenTelemetry `tracer`, `meter`, `logger`, or `propagator` to `withOpenTelemetryServer(...)` when constructing the client:

<Tabs items={["sdk/operations.ts", "app/telemetry-client.ts"]}>
  <Tab>
    ```typescript
    import {
      defineEventStream,
      defineRequest,
      defineWebSocket,
      struct,
    } from "@defjs/core";

    const readOrders = defineRequest({
      method: "GET",
      operation: "orders.read",
      path: "/orders",
    });
    const orderEvents = defineEventStream({
      operation: "orders.watch",
      path: "/orders/events",
      events: { update: struct.object({ id: struct.number() }) },
    });
    const orderSocket = defineWebSocket({
      operation: "orders.connect",
      path: "/orders/socket",
      incoming: struct.object({ id: struct.number() }),
    });
    ```

  </Tab>
  <Tab>
    ```typescript
    import { createClient, defineRequest, withEndpoint } from "@defjs/core";
    import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
    import { metrics, trace } from "@opentelemetry/api";
    import { logs } from "@opentelemetry/api-logs";

    const tracer = trace.getTracer("orders-service");
    const meter = metrics.getMeter("orders-service");
    const logger = logs.getLogger("@defjs/opentelemetry-server");
    const readOrders = defineRequest({
      method: "GET",
      operation: "orders.read",
      path: "/orders",
    });

    const client = createClient(
      withEndpoint("https://api.example.com"),
      withOpenTelemetryServer({ tracer, meter, logger }),
    );
    const metricsOnlyClient = createClient(
      withEndpoint("https://api.example.com"),
      withOpenTelemetryServer({ meter }),
    );
    const logsOnlyClient = createClient(
      withEndpoint("https://api.example.com"),
      withOpenTelemetryServer({ logger }),
    );

    async function main() {
      const [error] = await readOrders(client);
      if (error) {
        console.error(error.code);
        return;
      }
    }

    void main();
    ```

  </Tab>
</Tabs>

- **Span naming**: With `operation` set, span names become `GET orders.read`, `SSE orders.watch`, and `WebSocket orders.connect`; the span also carries the `defjs.operation` attribute. Without `operation`, span names fall back to the HTTP method, `SSE`, or `WebSocket`. The HTTP method in a span name is the normalized `http.request.method`, or `HTTP` when that value is `_OTHER`.
- **Independent signals**: `tracer`, `meter`, and `logger` are all optional and work independently:
  - Omit `tracer` to disable local span creation and span hooks while still recording metrics, logs, and outgoing context propagation.
  - Omit `meter` to disable package metrics.
  - Omit `propagator` to use a built-in composite W3C Trace Context + W3C Baggage propagator.
  - With a `tracer`, `requireParentSpan: true` skips spans, propagation, hooks, metrics, and logs when no active parent span exists; without a `tracer`, `requireParentSpan` blocks neither metrics nor logs.

---

## 2. Transport options, hooks, and propagation [#2-transport-options-hooks-and-propagation]

Configure per-transport switches (`{ enabled: false }`) and span hooks (`startSpanHook`, `requestHook`, `responseHook`) inside `http`, `sse`, and `webSocket`. For WebSocket connections where downstream services expect trace context in the handshake query string, opt into `queryPropagation: true`:

<Tabs items={["app/hooks.ts", "app/ws-propagation.ts", "app/active-span.ts"]}>
  <Tab>
    ```typescript
    import {
      createClient,
      createResolvedRequestUrl,
      withEndpoint,
    } from "@defjs/core";
    import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
    import { trace } from "@opentelemetry/api";

    const tracer = trace.getTracer("orders-service");
    const client = createClient(
      withEndpoint("https://api.example.com"),
      withOpenTelemetryServer({
        tracer,
        http: {
          startSpanHook(request) {
            const attributes = {
              "app.operation": request.operation ?? "unclassified",
            };
            if (!request.baseEndpoint) return attributes;
            const url = createResolvedRequestUrl(
              request.baseEndpoint,
              request.endpoint,
              request.query?.toString(),
            );
            url.searchParams.delete("access_token");
            return { ...attributes, "url.full": url.href };
          },
          requestHook(span, request) {
            span.setAttribute("app.request.started", true);
          },
          responseHook(span, response) {
            span.setAttribute("app.status", response.status);
          },
        },
        sse: { enabled: false },
        webSocket: { enabled: false },
      }),
    );
    ```

  </Tab>
  <Tab>
    ```ts
    import { createClient, withEndpoint } from "@defjs/core";
    import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
    import { trace } from "@opentelemetry/api";

    const tracer = trace.getTracer("orders-service");
    const client = createClient(
      withEndpoint("https://api.example.com"),
      withOpenTelemetryServer({
        tracer,
        webSocket: { queryPropagation: true },
      }),
    );
    ```

  </Tab>
  <Tab>
    ```typescript
    import { createClient, defineRequest, withEndpoint } from "@defjs/core";
    import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
    import { SpanStatusCode, trace } from "@opentelemetry/api";

    const tracer = trace.getTracer("orders-service");
    const client = createClient(
      withEndpoint("https://api.example.com"),
      withOpenTelemetryServer({ tracer }),
    );
    const readOrders = defineRequest({
      method: "GET",
      operation: "orders.read",
      path: "/orders",
    });

    const outcome = await tracer.startActiveSpan("orders.read", async (span) => {
      try {
        const outcome = await readOrders(client);
        const [error] = outcome;
        if (error) {
          span.setAttribute("error.type", error.code);
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        return outcome;
      } finally {
        span.end();
      }
    });
    ```

  </Tab>
</Tabs>

### Hook contract [#hook-contract]

- `startSpanHook(request): Attributes` runs synchronously before span creation; its returned attributes are applied last and can override built-in attributes (such as redacting `url.full`).
- `requestHook(span, request)` and `responseHook(span, responseOrHandle, request)` receive the created span and may be synchronous or async. They are **not** awaited by the transport pipeline, and the HTTP span ends immediately when the synchronous portion of `responseHook` returns.
- Hook failures never abort the client call. While `span.isRecording()` is true, hook errors record `defjs.otel.hook.error` and `exception` events on the span (the `exception` event, like the one recorded for a failed transport, carries only `exception.type`, never `exception.message` or `exception.stacktrace`); for non-recording spans, failures are reported via `@opentelemetry/api`'s `diag.error` (`hook.name`, `error.type`, `traceId`, `spanId`).
- `withOpenTelemetryServer` snapshots `http`, `sse`, and `webSocket` option blocks at creation time. Passing `{ enabled: false }` disables that transport without reading its hooks.

---

## 3. HTTP, SSE, and WebSocket telemetry semantics [#3-http-sse-and-websocket-telemetry-semantics]

The plugin measures transport lifetimes inside the interceptor chain:

- **HTTP**: The span starts in the HTTP interceptor and ends when the `HttpResponse` returns. Declared `output` / `error` bodies are read (and JSON representations checked and parsed) **inside** the handler boundary before returning. A body read or JSON media-type/parse failure rejects through the interceptor (`error.type: "BodyFailure"`), marks the span `ERROR`, records `BodyFailure` in metrics, and emits one `WARN` log. A request refused before it is sent (an invalid method, a URL with credentials, a header value the platform rejects, or a throwing `finalizeHeaders` hook) rejects through the interceptor too, with the platform's error or the hook's own error, so `error.type` is that error's class (typically `TypeError`). Status `400+` marks the span `ERROR` with the status code string as `error.type`. A caller cancellation is not a failure: the span ends with an `http.aborted` event and its status unset, with no exception and no `error.type`. A timeout stays a failure with `error.type: "timeout"`. Struct validation (`RES_STRUCT_MISMATCH`) and `HTTP_STATUS` tuple conversion happen after the interceptor chain and do not alter the completed transport span.
- **SSE**: One logical stream (including automatic reconnects) produces one span that remains open until `stream.closed` settles. Events recorded: `sse.connected`, followed by `sse.closed`, `sse.aborted` (for `stream.close()` or a non-timeout caller abort of the open stream or of the handshake; the span status stays unset), or `sse.error` (ending `ERROR`, including timeout-shaped caller aborts). The span attributes `url.full`, `server.address`, and `server.port` describe the first connection; a reconnect to another endpoint does not change them.
- **WebSocket**: One logical session (including automatic reconnects) produces one span until `session.closed` settles. Events recorded: `websocket.connected`, `websocket.closed`, `websocket.aborted`, `websocket.error`. Server close frames (any code) end the span with `websocket.closed` and leave its status unset; caller aborts, of an open session or while connecting, end it with `websocket.aborted`, its status unset and no log, except a `TimeoutError` abort reason, which ends the span `ERROR` with `error.type: "timeout"`, emits one `WARN`, and records `websocket.error` for an open session. Abrupt drops without a close frame (`1006`) end `ERROR` with one log on every runtime. As for SSE, `url.full`, `server.address`, and `server.port` describe the first connection and do not change on a reconnect to another endpoint. `url.full` uses the `ws:` or `wss:` form of the connection URL.

One rule covers the three transports. A caller cancellation (an abort that is not a timeout) is not a failure: the span status stays unset, the span records no exception and no `error.type`, and it gets the event `http.aborted`, `sse.aborted` or `websocket.aborted`. The duration metrics are still recorded, without `error.type`, and the connection metrics carry `defjs.result: "aborted"`. No log is emitted. A timeout (`ERR_TIMEOUT` or a `TimeoutError`, including the reason of `AbortSignal.timeout()`) stays a failure: the span ends `ERROR` and `error.type` is `timeout`.

The rest of the interceptor chain and the transport itself run with the client span active, so `trace.getActiveSpan()` there returns it and the spans they create, such as Fetch auto-instrumentation spans, are its children. Without a registered context manager, nothing changes.

`server.address` is the host of the resolved URL; an IPv6 literal keeps its square brackets, as in `URL.hostname` and the `Host` header. `server.port` is the explicit port or, when the URL has none, the scheme default: 80 for `http:` and `ws:`, 443 for `https:` and `wss:`. Every span also carries `http.request.method`: the request method for HTTP and SSE, and `GET` (the method of the opening handshake) for WebSocket. A method that is not one of the RFC 9110 methods, `PATCH`, or `QUERY` is recorded as `_OTHER`, with the method as given in `http.request.method_original`. A method that Fetch sends in upper case (`DELETE`, `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`) is recorded in upper case, and `http.request.method_original` keeps the method as given when the two differ. The `http.client.request.duration` metric and the HTTP log record carry the same normalized `http.request.method`.

### Retry and reconnect boundaries [#retry-and-reconnect-boundaries]

These are the current interceptor observations, not a separate balancer telemetry API:

- Each `withRetry` HTTP attempt has its own client span and duration sample, because every retry reruns the interceptor chain. With an active application parent span, the attempts are siblings under that parent; without one, retries are not automatically grouped into one trace. Core does not create a logical-call parent span.
- HTTP attempt URLs identify that attempt's endpoint, but no attempt number, retry reason, budget balance/exhaustion, or ejection/recovery attributes are emitted.
- SSE and WebSocket retries (`withRetry`) reconnect inside the transport without rerunning interceptors. They keep one logical-session span across reconnects, not one span per physical connection. Their span URL and metric attributes retain the initial endpoint even after failover. Reconnects do not emit another `connected` event. Active metrics count logical sessions awaiting `closed`, not sockets on the currently selected replica.
- An HTTP 503 gives `error.type: "503"`, a connection rejection gives `"TypeError"`, and a deadline gives `"timeout"`; a caller cancellation has no `error.type`. The deadline and the cancellation return `NET_TIMEOUT` and `NET_ABORTED` respectively; these Defjs tuple fault codes are not separate HTTP telemetry attributes. For an open WebSocket, default cancellation ends with `websocket.aborted` and no warning, while a `TimeoutError` abort reason ends with `websocket.error`, `error.type: "timeout"` and one warning. Other error class names are transport/runtime observations, not a substitute for inspecting the tuple or close outcome.

### Emitted metrics [#emitted-metrics]

When `meter` is supplied, instrument creation runs each time the option is applied to a client (using histogram bucket boundaries `0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10` seconds):

| Metric                                       | Meaning                                                 |
| -------------------------------------------- | ------------------------------------------------------- |
| `http.client.request.duration`               | HTTP attempt duration (seconds)                         |
| `defjs.client.sse.connect.duration`          | Time until SSE handle is returned                       |
| `defjs.client.sse.connection.duration`       | Handle return until terminal `stream.closed`            |
| `defjs.client.sse.active_streams`            | Active logical SSE streams with pending `closed`        |
| `defjs.client.websocket.connect.duration`    | Time until WebSocket session is returned                |
| `defjs.client.websocket.connection.duration` | Session return until terminal `session.closed`          |
| `defjs.client.websocket.active_connections`  | Active logical WebSocket sessions with pending `closed` |

The SSE and WebSocket connect and connection duration samples carry `defjs.result`: `success`, `error` (with `error.type`) or `aborted` for a caller cancellation.

---

## Logs and third-party loggers [#logs-and-third-party-loggers]

`logger?: Logger` accepts the standard `@opentelemetry/api-logs` interface and works with or without `tracer` and `meter`.

```ts
import {
  createClient,
  defineRequest,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import {
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";

const provider = new LoggerProvider({
  processors: [
    new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() }),
  ],
});

async function main() {
  try {
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() => {
        throw new Error("Demonstration transport failure");
      }),
      withOpenTelemetryServer({
        logger: provider.getLogger("@defjs/opentelemetry-server"),
      }),
    );
    const readOrders = defineRequest({
      method: "GET",
      path: "/orders",
      operation: "orders.read",
    });
    const [error] = await readOrders(client);
    if (error) {
      console.error(error.code);
      return;
    }
  } finally {
    await provider.shutdown();
  }
}

void main();
```

### Defjs diagnostic contract [#defjs-diagnostic-contract]

Each request or logical connection emits at most one terminal `WARN` (`13`) `LogRecord`:

| Observed outcome                                                                                                                                                 | Defjs LogRecord                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| HTTP OTel `next()` rejects (network failure, observed timeout, declared-body failure), excluding non-timeout active cancellation and public `HTTP_STATUS` faults | One `WARN`, `http.client.request.exception`, phase `request`                                    |
| Ordinary HTTP response (including 4xx/5xx whose declared `error` body decodes or has no declared body, or status `0`)                                            | None                                                                                            |
| Declared `output` / `error` body read fails, or a declared JSON representation has a non-JSON media type or fails `JSON.parse`                                   | One `WARN`, `http.client.request.exception`, phase `request`, `exception.type: "BodyFailure"`   |
| SSE or WebSocket handshake/connection fails (including SSE non-2xx status)                                                                                       | One `WARN`, `defjs.client.sse.exception` or `defjs.client.websocket.exception`, phase `connect` |
| SSE or WebSocket terminal error or rejected `closed` (including a `1006` drop without a close frame, heartbeat timeout)                                          | One `WARN` with the transport event name, phase `connection`                                    |
| Normal completion, messages, EOF, server WebSocket close frames (including `1011`), or active non-timeout cancellation                                           | None                                                                                            |

Diagnostics record a fixed message, `exception.type` (platform/transport class name such as `BodyFailure`, `EventStreamFatalError` (a non-`text/event-stream` SSE handshake), `DefjsFault` (including an SSE non-2xx handshake), `TypeError`, or `Error`), phase, static `operation`, server address/port, and protocol fields—never raw URLs, query strings, headers, bodies, or error stacks. A span's `exception` event follows the same rule and carries only `exception.type`; `url.full` replaces any userinfo in the endpoint with `REDACTED:REDACTED` and the values of the semantic-convention default sensitive query keys (such as `sig` and `X-Amz-Signature`) with `REDACTED`.

---

## Related recipes [#related-recipes]

- [Test with a local Fetch handle](/recipes/test-with-handle)
- [Consume an SSE stream](/recipes/consume-sse)
- [Open a WebSocket session](/recipes/websocket-session)
