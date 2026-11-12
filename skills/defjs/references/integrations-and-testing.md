# Framework Integrations (`@defjs/react`, `@defjs/vue`), OpenTelemetry (`@defjs/opentelemetry-server`), Testing, and SDK Packaging

Contents: [React integration (`@defjs/react`)](#1-react-integration-defjsreact) · [Vue integration (`@defjs/vue`)](#2-vue-integration-defjsvue) · [Server-side OpenTelemetry (`@defjs/opentelemetry-server`)](#3-server-side-opentelemetry-defjsopentelemetry-server) · [Deterministic offline testing (`with*Handle`)](#4-deterministic-offline-testing-withhandle) · [Publishing a standalone Defjs SDK package](#5-publishing-a-standalone-defjs-sdk-package) · [What Defjs intentionally does not provide](#6-what-defjs-intentionally-does-not-provide)

For full English guide pages on the official site (no locale prefix), fetch `https://defjs.lyz.cloud/llms.mdx/docs/integrations/react/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/integrations/vue/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/integrations/opentelemetry-server/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/testing/content.md`, and `https://defjs.lyz.cloud/llms.mdx/recipes/publish-http-sdk/content.md`.

---

## 1. React integration (`@defjs/react`)

`@defjs/react` exports `ClientProvider` and `useClient(overrideClient?)`. It is a thin Context bridge, not a query or cache library.

- **Critical rules**:
  1. Declare `defineRequest` / `defineEventStream` / `defineWebSocket` at **module scope**, never inside a component or Hook.
  2. `ClientProvider` accepts and `useClient()` returns a root `DerivableClient` (never a derived `client(options)` value).
  3. **Never pass `client` to `useState(client)` or `setState(client)`**—because `DerivableClient` is a function, React will invoke `client()` as a lazy initializer or updater.
  4. Always call `useClient(overrideClient)` unconditionally at the top of your component/Hook (never `overrideClient ?? useClient()`).

### Best practice: `ClientProvider` + `useEffect` HTTP request with abort cleanup

```tsx
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";
import { ClientProvider, useClient } from "@defjs/react";
import { useEffect, useState, type ReactNode } from "react";

const rootClient = createClient(withEndpoint("https://api.example.com"));

export function ApiProvider({ children }: { children: ReactNode }) {
  return <ClientProvider client={rootClient}>{children}</ClientProvider>;
}

const getOrder = defineRequest({
  method: "GET",
  operation: "orders.get",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ status: struct.string() }),
});

export function OrderStatus({ id }: { id: number }) {
  const client = useClient();
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    void getOrder(client({ signal: controller.signal }), { id }).then(
      ([error, order]) => {
        if (controller.signal.aborted) return;
        if (error) {
          setStatus(undefined);
          return;
        }
        setStatus(order.status);
      },
    );

    return () => controller.abort();
  }, [client, id]);

  return <span>{status ?? "Loading..."}</span>;
}
```

### Best practice: owning a WebSocket or SSE stream inside React `useEffect`

Pass `controller.signal` to `client({ signal })` and abort in the `useEffect` cleanup. The signal aborts both handshake and open session; ignore expected abort exits:

```tsx
import { defineWebSocket, struct } from "@defjs/core";
import { useClient } from "@defjs/react";
import { useEffect } from "react";

const quotes = defineWebSocket({
  operation: "quotes.stream",
  path: "/quotes",
  incoming: struct.object({ symbol: struct.string(), price: struct.number() }),
});

export function QuoteTicker() {
  const client = useClient();

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      const [error, session] = await quotes(
        client({ signal: controller.signal }),
      );
      if (error) {
        if (error.code !== "NET_ABORTED") console.error(error.code);
        return;
      }
      await using owned = session;
      try {
        for await (const message of owned.receive) {
          console.info(message.symbol, message.price);
        }
      } catch (cause) {
        if (!controller.signal.aborted) console.error("quotes failed", cause);
      }
    })();

    return () => controller.abort();
  }, [client]);

  return null;
}
```

---

## 2. Vue integration (`@defjs/vue`)

`@defjs/vue` exports `HTTP_CLIENT`, `createClientPlugin`, and `injectClient(key?)`.

- **Critical rules**:
  1. **Never pass `client` as the first argument to `watch(client, ...)` or `computed(client)`**, and do not wrap it in `ref()` or `reactive()`—because `DerivableClient` is a function, Vue would treat it as a getter and invoke `client()`.
  2. For multiple upstream services, type a custom `Symbol` as `InjectionKey<DerivableClient>`, provide it with `app.provide(KEY, serviceClient)`, and read it with `injectClient(KEY)`.

### Best practice: plugin setup, reactive `watch` with `onCleanup`, and `onScopeDispose` for streams

```ts
// main.ts
import { createClient, withEndpoint } from "@defjs/core";
import { createClientPlugin } from "@defjs/vue";
import { createApp } from "vue";
import App from "./App.vue";

const client = createClient(withEndpoint("https://api.example.com"));
createApp(App).use(createClientPlugin(client)).mount("#app");
```

```vue
<script setup lang="ts">
import { defineEventStream, defineRequest, struct } from "@defjs/core";
import { injectClient } from "@defjs/vue";
import { onScopeDispose, ref, watch } from "vue";

const props = defineProps<{ id: number }>();
const client = injectClient();
const status = ref("Loading...");

const getOrder = defineRequest({
  method: "GET",
  operation: "orders.get",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ status: struct.string() }),
});

watch(
  () => props.id,
  (id, _prev, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());

    void getOrder(client({ signal: controller.signal }), { id }).then(
      ([error, order]) => {
        if (controller.signal.aborted) return;
        status.value = error ? "Error" : order.status;
      },
    );
  },
  { immediate: true },
);

// For SSE or WebSocket in Vue setup, tie abort + close to onScopeDispose:
const deployEvents = defineEventStream({
  operation: "deployments.events",
  path: "/deployments/events",
  events: { line: struct.string() },
});

const streamController = new AbortController();
onScopeDispose(() => streamController.abort());

void (async () => {
  const [error, stream] = await deployEvents(
    client({ signal: streamController.signal }),
  );
  if (error) return;
  try {
    for await (const event of stream) {
      console.info(event.data);
    }
  } catch (cause) {
    if (!streamController.signal.aborted) console.error(cause);
  } finally {
    stream.close("scope-disposed");
    await stream.closed;
  }
})();
</script>
```

---

## 3. Server-side OpenTelemetry (`@defjs/opentelemetry-server`)

`@defjs/opentelemetry-server` instruments outbound HTTP, SSE, and WebSocket operations on a `@defjs/core` client via `withOpenTelemetryServer({ tracer?, meter?, logger?, ... })`.

- **Boundary**: The plugin does **not** initialize the OpenTelemetry SDK—configure your `TracerProvider`, `MeterProvider`, and `LoggerProvider` in application bootstrap code.
- **Low-cardinality `operation`**: Always set a static `operation` name (`"orders.read"`, `"orders.watch"`, `"orders.connect"`) on every definition. Spans are named `<METHOD> <operation>`, `SSE <operation>`, and `WebSocket <operation>`, and `defjs.operation` is recorded on spans and metrics. Never put dynamic IDs or URLs in `operation`.
- **WebSocket trace propagation**: Browser/standard WebSockets cannot set handshake headers. Enable `webSocket: { queryPropagation: true }` only when the server explicitly reads W3C `traceparent` / `tracestate` from query parameters (it replaces any existing same-name query pairs).
- **Attempts vs logical sessions**: HTTP retries emit one span per attempt as siblings under the active parent. SSE and WebSocket reconnects retain one logical-session span across reconnects. Caller aborts (`NET_ABORTED`) leave span status unset and emit no error log; timeouts (`NET_TIMEOUT`) mark the span `ERROR` with `error.type: "timeout"`.
- **Privacy defaults**: Request/response bodies, full headers, and `request.query` on `url.full` are never captured by default.

### Best practice: server client with OpenTelemetry tracing, metrics, and logs

```ts
import { createClient, defineRequest, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

export const listOrders = defineRequest({
  method: "GET",
  operation: "orders.list",
  path: "/orders",
});

export const serverClient = createClient(
  withEndpoint("https://api.internal.example.com"),
  withOpenTelemetryServer({
    tracer: trace.getTracer("orders-bff"),
    meter: metrics.getMeter("orders-bff"),
    logger: logs.getLogger("@defjs/opentelemetry-server"),
    webSocket: { queryPropagation: true },
  }),
);
```

---

## 4. Deterministic offline testing (`with*Handle`)

Never mock `defineRequest` or stub the operation function in unit tests—doing so skips input validation, `builder` placement, wire alias encoding, status dispatch, and response struct decoding. Instead, inject a local transport handle (`withHTTPHandle`, `withSSEHandle`, or `withWebSocketHandle`) on a test client:

### Best practice: testing an operation end-to-end with `withHTTPHandle`

```ts
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";
import { expect, test } from "vitest";

const postOrder = defineRequest({
  method: "POST",
  operation: "orders.create",
  path: "/orders/:region",
  input: struct.object({
    region: struct.string(),
    order: struct.object({
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    path: { region: input.region },
    body: input.order,
  }),
  output: struct.object({
    id: struct.number(),
    customerName: struct.string().alias("customer_name"),
  }),
  error: struct.object({ message: struct.string() }),
});

test("postOrder encodes wire aliases and decodes 201 and 400 responses", async () => {
  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withHTTPHandle(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://fixture.invalid/orders/eu");
      const body: unknown = await request.json();
      expect(body).toEqual({ customer_name: "Ada" });

      return Response.json({ id: 9, customer_name: "Ada" }, { status: 201 });
    }),
  );

  const [error, order, response] = await postOrder(client, {
    region: "eu",
    order: { customerName: "Ada" },
  });
  expect(error).toBeNull();
  expect(order).toEqual({ id: 9, customerName: "Ada" });
  expect(response?.status).toBe(201);
});
```

---

## 5. Publishing a standalone Defjs SDK package

When building a reusable SDK package (for example `@company/orders-sdk`):

1. Export **only** `defineRequest`, `defineEventStream`, `defineWebSocket` definitions, `struct` schemas, and `Infer<typeof ...>` types.
2. Never call `createClient`, never hardcode environment URLs, and never read credentials inside the SDK package.
3. Declare `"@defjs/core": "^0.7.0"` under `peerDependencies` (and `devDependencies` for local tests) in the SDK's `package.json`, and ship ESM + `.d.ts` declarations (`"type": "module"`).

---

## 6. What Defjs intentionally does not provide

| Removed or non-existent feature                           | What to write instead                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A global client singleton or `client.execute` method      | Create an application-owned `createClient(...)` and call `operation(client, input)` |
| Command objects or separate command executor functions    | Definitions are callable operations: `await getOrder(client, input)`                |
| Client-level default timeout or `timeout`/`abort` options | `client({ signal: AbortSignal.timeout(ms) })` or `withRetry({ attemptTimeoutMs })`  |
| Separate SSE or WebSocket reconnect helpers               | Unified `withRetry(...)` and per-call `client({ retry })`                           |
| A `responseType` field on `defineRequest`                 | The `output` / `error` struct kind (`struct.string()`, `struct.blob()`, etc.)       |
| `schema.parse()` on a struct instance or `struct.encode`  | `struct.parse(schema, value, options?)` and `builder` placement                     |
| Custom WebSocket handshake headers                        | Cookies, short-lived query tickets, or `client({ protocols })`                      |
| WebSocket message-map object                              | `struct.discriminatedUnion("type", [...])` on `incoming` and `outgoing`             |
