# Server-side OpenTelemetry (`@defjs/opentelemetry-server`)

Contents: [Boundary and setup](#boundary-and-setup) · [Low-cardinality `operation` names](#low-cardinality-operation-names) · [Transport options and WebSocket propagation](#transport-options-and-websocket-propagation) · [Redaction and safety](#redaction-and-safety)

## Boundary and setup

`@defjs/opentelemetry-server` instruments outbound HTTP, SSE, and WebSocket operations on a `@defjs/core` client by appending interceptors via `withOpenTelemetryServer(...)`.

- It does **not** initialize the OpenTelemetry SDK; initialize your `TracerProvider`, `MeterProvider`, and `LoggerProvider` in application bootstrap code.
- Each of `tracer`, `meter`, and `logger` is optional—pass only the signals you want to emit.

```ts
import { createClient, defineRequest, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

const tracer = trace.getTracer("orders-service");
const meter = metrics.getMeter("orders-service");
const logger = logs.getLogger("@defjs/opentelemetry-server");

export const readOrders = defineRequest({
  method: "GET",
  operation: "orders.read",
  path: "/orders",
});

export const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({ tracer, meter, logger }),
);
```

## Low-cardinality `operation` names

Always set a static, low-cardinality `operation` field on `defineRequest`, `defineEventStream`, and `defineWebSocket`:

```ts
import {
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
} from "@defjs/core";

export const readOrders = defineRequest({
  method: "GET",
  operation: "orders.read",
  path: "/orders",
});

export const orderEvents = defineEventStream({
  operation: "orders.watch",
  path: "/orders/events",
  events: { update: struct.object({ id: struct.number() }) },
});

export const orderSocket = defineWebSocket({
  maxIncomingQueueSize: 100,
  operation: "orders.connect",
  path: "/orders/socket",
  incoming: struct.object({ id: struct.number() }),
});
```

- The plugin uses `operation` in span names and as the `defjs.operation` attribute.
- Never embed user IDs, order IDs, tenants, or query strings in `operation`—high-cardinality values blow up metric series.

## Transport options and WebSocket propagation

- HTTP and SSE propagate trace context (`traceparent`, `tracestate`, baggage) through outgoing request headers by default.
- WebSockets cannot carry custom handshake headers. When the server explicitly accepts W3C trace context in query parameters, enable `webSocket: { queryPropagation: true }`:

```ts
import { createClient, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { trace } from "@opentelemetry/api";

export const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({
    tracer: trace.getTracer("orders-service"),
    webSocket: { queryPropagation: true },
  }),
);
```

## Redaction and safety

- Request/response bodies and full headers are **never** captured by default.
- By default, `url.full` does not append the independent `request.queryString`; this is not redaction. The plugin has no built-in redactor or sensitive-key policy. Applications that set `url.full` or other URL attributes through hooks must construct and redact those values themselves.
