# Framework Integrations (`@defjs/react`, `@defjs/vue`), OpenTelemetry (`@defjs/opentelemetry-server`), Testing, and SDK Packaging

Contents: [React integration (`@defjs/react`)](#1-react-integration-defjsreact) · [Vue integration (`@defjs/vue`)](#2-vue-integration-defjsvue) · [Server-side OpenTelemetry (`@defjs/opentelemetry-server`)](#3-server-side-opentelemetry-defjsopentelemetry-server) · [Testing your Defjs project (`with*Handle`)](#4-testing-your-defjs-project-withhandle) · [In-app API layer & public SDK architecture](#5-in-app-api-layer--public-sdk-architecture) · [OpenAPI codegen (`@defjs/cli`) and `MessagePort` proxy (`@defjs/core/port`)](#6-openapi-codegen-defjscli-and-messageport-proxy-defjscoreport) · [What Defjs intentionally does not provide](#7-what-defjs-intentionally-does-not-provide)

For full English guide pages on the official site (no locale prefix), fetch `https://defjs.lyz.cloud/llms.mdx/docs/integrations/react/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/integrations/vue/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/integrations/opentelemetry-server/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/testing/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/best-practices/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/application-api/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/public-sdk/content.md`, and `https://defjs.lyz.cloud/llms.mdx/recipes/publish-http-sdk/content.md`.

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
  meta: { operation: "orders.get" },
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
      ([err, order]) => {
        if (controller.signal.aborted) return;
        if (err) {
          setStatus(err.message);
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
  meta: { operation: "quotes.stream" },
  path: "/quotes",
  incoming: struct.object({ symbol: struct.string(), price: struct.number() }),
});

export function QuoteTicker() {
  const client = useClient();

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      const [err, session] = await quotes(
        client({ signal: controller.signal }),
      );
      if (err) {
        if (err.code !== "NET_ABORTED") console.error(err.code);
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

```ts
// orders.ts — keep definitions at module scope outside components
import { defineEventStream, defineRequest, struct } from "@defjs/core";

export const getOrder = defineRequest({
  method: "GET",
  meta: { operation: "orders.get" },
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ status: struct.string() }),
});

export const deployEvents = defineEventStream({
  meta: { operation: "deployments.events" },
  path: "/deployments/events",
  events: { line: struct.string() },
});
```

```vue
<!-- OrderPanel.vue -->
<script setup lang="ts">
import { injectClient } from "@defjs/vue";
import { onScopeDispose, ref, watch } from "vue";
import { deployEvents, getOrder } from "./orders";

const props = defineProps<{ id: number }>();
const client = injectClient();
const status = ref("Loading...");

watch(
  () => props.id,
  (id, _prev, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());

    void getOrder(client({ signal: controller.signal }), { id }).then(
      ([err, order]) => {
        if (controller.signal.aborted) return;
        if (err) {
          status.value = err.message;
          return;
        }
        status.value = order.status;
      },
    );
  },
  { immediate: true },
);

// For SSE or WebSocket in Vue setup, tie abort + close to onScopeDispose:
const streamController = new AbortController();
onScopeDispose(() => streamController.abort());

void (async () => {
  const [err, stream] = await deployEvents(
    client({ signal: streamController.signal }),
  );
  if (err) {
    if (err.code !== "NET_ABORTED") console.error(err.code);
    return;
  }
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

`@defjs/opentelemetry-server` instruments every operation call and its outbound HTTP, SSE, and WebSocket transport on a `@defjs/core` client via `withOpenTelemetryServer({ tracer?, meter?, logger?, ... })`. Install it once on the client every call goes through; call sites then do not log failures themselves.

- **Boundary**: The plugin does **not** initialize the OpenTelemetry SDK—configure your `TracerProvider`, `MeterProvider`, `LoggerProvider`, and context manager in application bootstrap code.
- **One call, one operation span**: Each call gets an `INTERNAL` span named `defjs.operation.name` (such as `GET /orders/:id`) from the call to its tuple, covering input validation, the builder, retries, and response decoding. A failure ends it `ERROR` with `error.type` set to the fault code (`REQ_INPUT_INVALID`, `RES_STRUCT_MISMATCH`, `NET_TIMEOUT`, ...). The meter records `defjs.client.operation.duration`, and the logger emits one `WARN` `defjs.client.operation.exception` record per failed call.
- **Transport spans**: Each HTTP attempt, and each SSE or WebSocket connection, gets a `CLIENT` span under the operation span. SSE and WebSocket reconnects retain one logical-session span; a failure after open logs once on `defjs.client.sse.exception` / `defjs.client.websocket.exception`.
- **Parents**: A call inside an active span joins its trace; a call without one starts its own trace. There is no option to skip parentless calls; use the SDK sampler.
- **Application-defined `meta`**: Attach `meta` (`{ [key: string]: unknown }`, for example `{ operation: "orders.read" }`) when interceptors need context. `@defjs/opentelemetry-server` reports each key as a `defjs.meta.<key>` attribute on spans and failure logs (not metrics); an empty `meta` adds nothing. It is one read-only object shared by every call of the definition, and Defjs core never sends it with the request.
- **WebSocket trace propagation**: Browser/standard WebSockets cannot set handshake headers. Enable `webSocket: { queryPropagation: true }` only when the server explicitly reads W3C `traceparent` / `tracestate` from query parameters (it replaces any existing same-name query pairs).
- **Cancellation and timeouts**: Caller aborts (`NET_ABORTED`) leave span status unset and emit no log; timeouts mark the transport span `ERROR` with `error.type: "timeout"` and the operation span with `NET_TIMEOUT`.
- **Privacy defaults**: Request/response bodies, full headers, `request.query` on `url.full`, and error messages and stacks are never captured by default. `includeErrorDiagnostics: true` exports the error message and stack on failed spans and failure logs; platform error text can quote the request URL, and the cause chain is never exported.

### Best practice: server client with OpenTelemetry tracing, metrics, and logs

```ts
import { createClient, defineRequest, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

export const listOrders = defineRequest({
  method: "GET",
  meta: { operation: "orders.list" },
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

## 4. Testing your Defjs project (`with*Handle`)

`@defjs/core` already tests its own transport and codec engine. Tests inside an application or SDK project exist to verify **the code the project wrote**—its `defineRequest` / `defineEventStream` / `defineWebSocket` definitions and `struct` schemas (`src/api/request/`, `src/api/schema/`), its custom interceptors (`src/api/client.ts`), its business orchestration helpers (`src/checkout.ts`), its realtime consumers, and its React/Vue components:

| Layer in your project                                                 | What your test verifies                                                                | How to wire the test `Client`                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Request definitions & schemas (`src/api/request/`, `src/api/schema/`) | `builder` placement (`path`, `query`, `headers`, `body`), `.alias()`, `output`/`error` | Import the real operation and pass a fresh `withHTTPHandle` client                           |
| Business helpers & custom interceptors (`checkout.ts`, `client.ts`)   | Auth/header interceptors, multi-step flows, error-first tuple mapping, retries         | Pass `testClient` into your helper (with `withInterceptors(...)` mounted)                    |
| SSE & WebSocket consumers (`src/events/`, `src/quotes/`)              | Stream/frame parsing in business logic, outgoing frames, `await using` cleanup         | Feed simulated frames in memory via `withSSEHandle` or `withWebSocketHandle`                 |
| React / Vue components (`OrderCard.tsx`, `OrderView.vue`)             | Loading states, rendered API data, error UI, unmount `AbortController` cleanup         | Wrap with `<ClientProvider client={testClient}>` or install `createClientPlugin(testClient)` |

Testing rules for project code:

- **Do not `vi.mock` Defjs operations** (`defineRequest`, `defineEventStream`, `defineWebSocket`): mocking skips `builder` placement, `.alias()` encoding, interceptors, status dispatch, and `struct` decoding.
- **Accept `Client` (or `DerivableClient`) by parameter**: Keep `src/api/request/*.ts` free of production client singletons. In business helpers, pass `client: Client` (or `client: DerivableClient` when calling `client({ signal })`) first—or place a defaulted `client: Client = apiClient` last—so tests inject `testClient` without mocking modules.
- **Keep each test isolated**: Create a fresh `createClient(...)` per test so retry budgets and closures never leak. Omit `withRetry(...)` on baseline unit-test clients so `502`/`503`/`504` and network errors return after one attempt.

### 4.1 Testing project definitions, custom interceptors, and business helpers (`withHTTPHandle`)

Pass a fresh `withHTTPHandle` test `Client` (mounting custom `createHttpInterceptor` policies via `withInterceptors(...)`) into your real operations and business helpers:

- Assert outbound `new Request(input, init)` URLs, headers, and serialized JSON/alias keys.
- Narrow errors Go-style: check `if (err)` first (`if (err.code === "HTTP_STATUS")` for `err.status` / `err.data` / `err.response`, or `err.cause` on decode/wrapped faults), and guard success assertions with `if (err) throw err;` after `expect(err).toBeNull()`.
- Use `https://fixture.invalid` with `withEndpoint(...)` so no test can accidentally touch a real host, and separate request handler setup from assertions inside your test helper or `withHTTPHandle`.

| Simulated scenario in `withHTTPHandle`               | Resulting tuple (`[err, data, res]`)           | Notes                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Response.json(body)` (`200`)                        | `err === null`, validated `data`               | Missing `application/json` triggers `RES_MEDIA_TYPE_INVALID`                                                          |
| `Response.json(errBody, { status: 4xx/5xx })`        | `err.code === "HTTP_STATUS"`, `err.data`       | Requires `error: struct(...)` on `defineRequest` to decode `data`                                                     |
| Malformed JSON (`"{bad"`) or non-JSON `Content-Type` | `RES_DECODE_FAILED` / `RES_MEDIA_TYPE_INVALID` | Exact cause sits on `err.cause`                                                                                       |
| `Promise.reject(new TypeError("fetch failed"))`      | `err.code === "NET_UNREACHABLE"`               | Reject the promise instead of returning `Response.error()` (`status: 0` reads as non-ok HTTP unless wrapped by Fetch) |

```ts
// Simulating a transport failure -> err.code === "NET_UNREACHABLE"
const offlineClient = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(() => Promise.reject(new TypeError("fetch failed"))),
);

// Testing withRetry recovery on POST vs. interceptor-level 401 refresh replay
let postAttempts = 0;
const retryingPostClient = createClient(
  withEndpoint("https://fixture.invalid"),
  withRetry({ maxRetries: 2, delayMs: 0, methods: ["POST"] }), // Note: overwrites default idempotent methods!
  withHTTPHandle(() => {
    postAttempts += 1;
    if (postAttempts === 1) return new Response(null, { status: 503 });
    return Response.json({ id: 7, status: "queued" });
  }),
);

// 401 refresh replay runs inside createHttpInterceptor via next(req) (not withRetry)
const refreshOn401 = createHttpInterceptor(async (req, next) => {
  const result = await next(req);
  const [err] = result;
  if (err && err.code === "HTTP_STATUS" && err.status === 401) {
    const retryReq = req.clone();
    retryReq.headers.set("authorization", "Bearer fresh");
    return next(retryReq);
  }
  return result;
});
```

```ts
// src/checkout.ts — project operation, custom interceptor, and business helper
import {
  createHttpInterceptor,
  defineRequest,
  struct,
  type Client,
} from "@defjs/core";

export const submitOrder = defineRequest({
  method: "POST",
  meta: { operation: "orders.submit" },
  path: "/orders",
  input: struct.object({
    idempotencyKey: struct.string(),
    order: struct.object({
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    headers: { "idempotency-key": input.idempotencyKey },
    body: input.order,
  }),
  output: struct.object({
    id: struct.number(),
    customerName: struct.string().alias("customer_name"),
  }),
  error: struct.object({
    message: struct.string(),
  }),
});

export function bearerAuth(token: string) {
  return createHttpInterceptor((request, next) => {
    const headers = new Headers(request.headers);
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    return next({ ...request, headers });
  });
}

export async function checkoutOrder(
  client: Client,
  input: { customerName: string; idempotencyKey: string },
): Promise<
  [Error, undefined] | [null, { orderId: number; customerName: string }]
> {
  const [err, order] = await submitOrder(client, {
    idempotencyKey: input.idempotencyKey,
    order: { customerName: input.customerName },
  });
  if (err) {
    if (err.code === "HTTP_STATUS" && err.status === 409) {
      return [
        new Error(`duplicate order: ${err.data.message}`, { cause: err }),
        undefined,
      ];
    }
    return [new Error("submit order", { cause: err }), undefined];
  }
  return [null, { orderId: order.id, customerName: order.customerName }];
}
```

```ts
// test/checkout.spec.ts — isolated per-test Client verifying wire format, auth header, and domain mapping
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "@defjs/core";
import { expect, test } from "vitest";
import { bearerAuth, checkoutOrder } from "../src/checkout.ts";

test("checkoutOrder attaches bearer auth, maps wire fields, and returns the order", async () => {
  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withInterceptors(bearerAuth("test-token")),
    withHTTPHandle(async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://fixture.invalid/orders");
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
      expect(request.headers.get("idempotency-key")).toBe("idem-1");
      const body: unknown = await request.json();
      expect(body).toEqual({ customer_name: "Ada" });

      return Response.json({ id: 42, customer_name: "Ada" }, { status: 201 });
    }),
  );

  const [err, result] = await checkoutOrder(client, {
    customerName: "Ada",
    idempotencyKey: "idem-1",
  });
  expect(err).toBeNull();
  if (err) throw err;
  expect(result).toEqual({ orderId: 42, customerName: "Ada" });
});

test("checkoutOrder translates a 409 conflict into a domain error", async () => {
  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withHTTPHandle(() =>
      Promise.resolve(
        Response.json({ message: "Order already paid" }, { status: 409 }),
      ),
    ),
  );

  const [err, result] = await checkoutOrder(client, {
    customerName: "Ada",
    idempotencyKey: "idem-1",
  });
  if (err) {
    expect(result).toBeUndefined();
    expect(err.message).toBe("duplicate order: Order already paid");
    return;
  }
  expect.unreachable("expected duplicate order error");
});
```

### 4.2 Testing project SSE consumers (`withSSEHandle`)

Pass a `withSSEHandle` client returning a `Response` backed by a `ReadableStream<Uint8Array>` (`content-type: "text/event-stream"`) into your project's SSE consumer function and assert its output:

```ts
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
  withSSEHandle,
  type Client,
} from "@defjs/core";
import { expect, test } from "vitest";

const watchDeployments = defineEventStream({
  path: "/deployments/:id/events",
  input: struct.object({ id: struct.string() }),
  builder: (input) => ({ path: input }),
  events: {
    progress: struct.object({
      step: struct.string(),
      percent: struct.number(),
    }),
  },
});

export async function collectDeploymentSteps(
  client: Client,
  id: string,
): Promise<[Error, undefined] | [null, string[]]> {
  const [err, stream] = await watchDeployments(client, { id });
  if (err) {
    return [new Error("watch deployments", { cause: err }), undefined];
  }

  await using ownedStream = stream;
  const steps: string[] = [];
  try {
    for await (const event of ownedStream) {
      steps.push(`${event.data.step}:${event.data.percent}%`);
    }
  } catch (cause) {
    return [new Error("read deployment stream", { cause }), undefined];
  }
  return [null, steps];
}

test("collectDeploymentSteps reads progress events from an in-memory SSE stream", async () => {
  const frames = [
    'id: evt-1\nevent: progress\ndata: {"step":"build","percent":50}\n\n',
    'id: evt-2\nevent: progress\ndata: {"step":"deploy","percent":100}\n\n',
  ].join("");
  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withSSEHandle((input) => {
      expect(new Request(input).url).toBe(
        "https://fixture.invalid/deployments/dep-9/events",
      );
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(frames));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      );
    }),
  );

  const [err, steps] = await collectDeploymentSteps(client, "dep-9");
  expect(err).toBeNull();
  if (err) throw err;
  expect(steps).toEqual(["build:50%", "deploy:100%"]);
});
```

### 4.3 Testing project WebSocket consumers (`withWebSocketHandle`)

Provide a minimal `EventTarget` subclass implementing `WebSocketHandle` (with `static readonly OPEN = 1`) and pass a `withWebSocketHandle` client into your project's WebSocket consumer helper:

```ts
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withWebSocketHandle,
  type Client,
  type WebSocketHandle,
} from "@defjs/core";
import { expect, test } from "vitest";

const liveQuotes = defineWebSocket({
  path: "/quotes",
  outgoing: struct.object({
    type: struct.literal("subscribe"),
    symbol: struct.string(),
  }),
  incoming: struct.object({
    symbol: struct.string(),
    priceCents: struct.number().alias("price_cents"),
  }),
});

export async function readFirstQuote(
  client: Client,
  symbol: string,
): Promise<[Error, undefined] | [null, number]> {
  const [err, session] = await liveQuotes(client);
  if (err) {
    return [new Error("connect quotes", { cause: err }), undefined];
  }

  await using ownedSession = session;
  let runtimeError: unknown;
  const unsubscribe = ownedSession.onRuntimeError((cause) => {
    runtimeError ??= cause;
  });
  try {
    ownedSession.send({ type: "subscribe", symbol });
    for await (const quote of ownedSession.receive) {
      if (quote.symbol === symbol) {
        return [null, quote.priceCents];
      }
    }
  } catch (cause) {
    return [new Error("read quote", { cause }), undefined];
  } finally {
    unsubscribe();
  }
  return [
    new Error(
      "quote stream ended before a quote arrived",
      runtimeError ? { cause: runtimeError } : undefined,
    ),
    undefined,
  ];
}

function makeFakeQuoteSocket(sent: string[]) {
  return class FakeQuoteSocket extends EventTarget implements WebSocketHandle {
    static readonly OPEN = 1;
    readonly url: string;
    readonly protocol = "";
    readonly extensions = "";
    readonly bufferedAmount = 0;
    readyState = 0;

    constructor(url: string) {
      super();
      this.url = url;
      queueMicrotask(() => {
        this.readyState = FakeQuoteSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (typeof data === "string") {
        sent.push(data);
        queueMicrotask(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ symbol: "ACME", price_cents: 1850 }),
            }),
          );
        });
      }
    }

    close(code = 1000, reason = ""): void {
      this.readyState = 3;
      queueMicrotask(() => {
        this.dispatchEvent(
          new CloseEvent("close", { code, reason, wasClean: true }),
        );
      });
    }
  };
}

test("readFirstQuote sends a subscription and returns the first quote price", async () => {
  const sent: string[] = [];
  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withWebSocketHandle(makeFakeQuoteSocket(sent)),
  );

  const [err, priceCents] = await readFirstQuote(client, "ACME");
  expect(err).toBeNull();
  if (err) throw err;
  expect(priceCents).toBe(1850);
  expect(sent).toEqual(['{"type":"subscribe","symbol":"ACME"}']);
});
```

### 4.4 Organizing project layers & testing React / Vue components

Follow three conventions so every layer in a user project tests cleanly without `vi.mock`:

- **Keep `src/api/request/*.ts` client-free**: Export pure `defineRequest` / `defineEventStream` / `defineWebSocket` values only; never import `apiClient` inside definition files.
- **Accept `Client` (or `DerivableClient`) in business helpers**:
  - Pass `client` first (`placeOrder(client: Client, input: ...)`, or `client: DerivableClient` if the helper derives `client({ signal })`), or pass `client: Client = apiClient` last so production code omits it while unit tests pass `testClient`.
  - Export custom interceptors and SSR factories (`createServerApiClient(token, ...options: ClientOption[])` forwarding `...options` to `createClient(...)`) from `src/api/client.ts` so tests can mount `withHTTPHandle`.
- **React (`@defjs/react`)**: Wrap the component under test with `<ClientProvider client={testClient}>` (or pass `testClient` explicitly to hooks/components using `useClient(overrideClient)`). Never pass `client` directly to React `setState(client)` since `DerivableClient` is callable.
- **Vue (`@defjs/vue`)**: Install `global: { plugins: [createClientPlugin(testClient)] }` (or `provide(HTTP_CLIENT, testClient)`) when mounting components. Never pass `client` directly as the first argument to `watch(client, ...)` or `computed(client)`.

```tsx
// React Testing Library example
import { render, screen } from "@testing-library/react";
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { ClientProvider } from "@defjs/react";

it("renders order status from the test client", async () => {
  const testClient = createClient(
    withEndpoint("https://fixture.invalid"),
    withHTTPHandle(() => Response.json({ id: 7, status: "paid" })),
  );

  render(
    <ClientProvider client={testClient}>
      <OrderStatus id={7} />
    </ClientProvider>,
  );

  expect(await screen.findByText("paid")).toBeDefined();
});
```

```ts
// Vue Test Utils example
import { flushPromises, mount } from "@vue/test-utils";
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { createClientPlugin } from "@defjs/vue";

it("renders order status with createClientPlugin", async () => {
  const testClient = createClient(
    withEndpoint("https://fixture.invalid"),
    withHTTPHandle(() => Response.json({ id: 7, status: "paid" })),
  );

  const wrapper = mount(OrderStatus, {
    props: { id: 7 },
    global: { plugins: [createClientPlugin(testClient)] },
  });
  await flushPromises();

  expect(wrapper.text()).toContain("paid");
});
```

### 4.5 Deterministic time and request deadlines

- **Vitest / Bun fake timers**: Use `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })` (`jest.useFakeTimers()` in Bun test) for retry backoff, SSE/WebSocket reconnect delays, and heartbeats.
- **Native `AbortSignal.timeout` does not advance under fake timers**: Trigger deterministic request deadlines via an `AbortController` aborted from a controlled `setTimeout(..., ms)` with `new DOMException("request deadline", "TimeoutError")`, or test per-attempt retry deadlines via `withRetry({ maxRetries: 0, attemptTimeoutMs })` (which uses `setTimeout` instead of `AbortSignal.timeout`).
- **Advance only after startup**: For SSE/WebSocket timers, `await ready` before calling `vi.advanceTimersByTimeAsync(...)`. Assert state transitions or attempt counts rather than elapsed wall-clock time, and restore real timers in `finally`.

### 4.6 Common testing pitfalls

- **`withRetry(undefined)` vs. `withRetry({ maxRetries: 0 })`**: Passing `undefined` falls back to default retry policy (`maxRetries: 3`, backoff enabled); set `{ maxRetries: 0 }` explicitly (or omit `withRetry`) when retries must stay disabled.
- **`methods: ["POST"]` replaces defaults**: Passing `withRetry({ methods: ["POST"] })` overrides Defjs's default idempotent method list; include `"GET"` / `"HEAD"` too if one test client shares retries across read and write calls.
- **`401` / error `err.data` stays `undefined` without `error:` schema**: Non-2xx bodies are only decoded into `err.data` when `defineRequest` declares `error: ApiError` (a `struct`).
- **`content-type` headers in handles**: Mock JSON HTTP responses with `Response.json(...)` (sets `content-type: application/json`), and mock SSE responses in `withSSEHandle` with `"content-type": "text/event-stream"`; wrong or missing content types fail with `RES_MEDIA_TYPE_INVALID` before reading the body.
- **`FakeQuoteSocket` microtasks & mid-stream faults**: Schedule simulated inbound frames via `queueMicrotask` after `connect()` returns, and trigger `close(code, reason)` / `error()` inside `queueMicrotask` to test mid-stream SSE/WebSocket `catch` and cleanup paths.
- **`withXSRF()` is browser-only**: Importing or mounting `withXSRF()` in Node/Bun tests throws `Error("withXSRF is only supported in browser environments")`—skip it on server/test clients or import conditionally from `@defjs/core/xsrf`.

---

## 5. In-app API layer & public SDK architecture

Defjs supports two primary project layouts that share the same `schema/` + `request/` (pure operation functions) structure:

| Scenario                                                                                                                                   | Layout                                                           | Who owns `createClient(...)`?                                                                        |
| :----------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| **Application API layer (`src/api/`)** — Hand-writing HTTP/realtime requests inside an app repository (replacing `axios`/`fetch` wrappers) | `src/api/schema/` + `src/api/request/` + `src/api/client.ts`     | Your app (`src/api/client.ts` exports a browser singleton `apiClient` or an SSR per-request factory) |
| **Public SDK package (`@company/s3-sdk`)** — Publishing an external npm SDK for a company's public API                                     | `src/schema/` + `src/request/` + `src/index.ts` (`package.json`) | External consumer applications (the SDK package never creates or captures a `Client`)                |

```text
@company/s3-sdk/ (or src/api/ inside an app repo)
├── src/
│   ├── schema/           # Shared struct schemas + Infer<typeof ...> same-name types
│   │   ├── common.ts     # S3Error, StorageClass
│   │   ├── bucket.ts     # Bucket, ListBucketsOutput
│   │   └── object.ts     # ObjectSummary, ListObjectsOutput
│   ├── request/         # Domain modules grouped by resource tag
│   │   ├── buckets.ts    # listBuckets, headBucket, deleteBucket
│   │   └── objects.ts    # listObjectsV2, headObject, getObject, putObject, deleteObject
│   └── index.ts          # Flat barrel re-exports (or client.ts in an in-app src/api/ layer)
├── package.json          # "type": "module", "sideEffects": false, peerDependencies: { "@defjs/core": "^0.9.0" }
└── tsconfig.json
```

- **Architecture rules**:
  1. **Pure functions, never `Service` classes**: Unlike legacy OpenAPI generators that wrap endpoints in stateful classes (`ObjectsService.putObject(...)` or `new S3Client()`), every operation in `src/request/*.ts` is exported directly as a standalone `defineRequest` / `defineEventStream` / `defineWebSocket` value and called as `await putObject(client, input)` or `await getObject(client({ signal }), input)`. Never wrap operations in a `class` or a namespace object—standalone exports preserve per-call `client(options)` derivation and allow bundlers to tree-shake unused operations when `"sideEffects": false` is set.
  2. **Same-name `struct` + `Infer` exports in `schema/`**: Export both `export const S3Error = struct.object(...)` and `export type S3Error = Infer<typeof S3Error>` so consumers import one identifier for both runtime schemas and TypeScript types.
  3. **Keep `request/*.ts` client-free in both scenarios**: Even inside an application's `src/api/`, never import `apiClient` inside `src/api/request/*.ts`. Keep `createClient(...)` in `src/api/client.ts` so operations remain directly testable with `withHTTPHandle` and reusable across browser singletons and SSR per-request clients.
  4. **Public SDK package metadata**: When publishing an external SDK package, declare `"@defjs/core": "^0.9.0"` under `peerDependencies` (and `devDependencies` for local tests) with `"type": "module"` and `"sideEffects": false`.

### Best practice: hand-written S3 SDK (`schema/` + `request/` + application consumer)

```ts
// src/schema/common.ts
import { struct, type Infer } from "@defjs/core";

export const StorageClass = struct.enum([
  "STANDARD",
  "INTELLIGENT_TIERING",
  "GLACIER",
] as const);
export type StorageClass = Infer<typeof StorageClass>;

export const S3Error = struct.object({
  code: struct.string(),
  message: struct.string(),
  resource: struct.string().optional(),
  requestId: struct.string().optional().alias("request_id"),
});
export type S3Error = Infer<typeof S3Error>;
```

```ts
// src/schema/object.ts
import { struct, type Infer } from "@defjs/core";
import { StorageClass } from "./common.ts";

export const ObjectSummary = struct.object({
  key: struct.string(),
  size: struct.number(),
  etag: struct.string(),
  lastModified: struct.date().alias("last_modified"),
  storageClass: StorageClass.alias("storage_class"),
});
export type ObjectSummary = Infer<typeof ObjectSummary>;

export const ListObjectsOutput = struct.object({
  name: struct.string(),
  prefix: struct.string().optional(),
  isTruncated: struct.boolean().alias("is_truncated"),
  nextContinuationToken: struct
    .string()
    .optional()
    .alias("next_continuation_token"),
  contents: struct.array(ObjectSummary),
});
export type ListObjectsOutput = Infer<typeof ListObjectsOutput>;
```

```ts
// src/request/objects.ts
import { defineRequest, struct, type Infer } from "@defjs/core";
import { S3Error, StorageClass } from "../schema/common.ts";
import { ListObjectsOutput } from "../schema/object.ts";

// Wrong: wrapping operations in a Service class or capturing a client
// export class ObjectsService {
//   constructor(private readonly client: Client) {}
//   putObject(input: PutObjectInput) { ... }
// }

// Right: export standalone pure operation definitions
export const ListObjectsInput = struct.object({
  bucket: struct.string(),
  prefix: struct.string().optional(),
  continuationToken: struct.string().optional(),
  maxKeys: struct.number().optional(),
});
export type ListObjectsInput = Infer<typeof ListObjectsInput>;

export const listObjectsV2 = defineRequest({
  meta: { operation: "s3.objects.listV2" },
  method: "GET",
  path: "/:bucket",
  input: ListObjectsInput,
  builder: (input) => ({
    path: { bucket: input.bucket },
    query: {
      "list-type": 2,
      prefix: input.prefix,
      "continuation-token": input.continuationToken,
      "max-keys": input.maxKeys,
    },
  }),
  output: ListObjectsOutput,
  error: S3Error,
});

export const GetObjectInput = struct.object({
  bucket: struct.string(),
  key: struct.string(),
  ifNoneMatch: struct.string().optional(),
});
export type GetObjectInput = Infer<typeof GetObjectInput>;

export const getObject = defineRequest({
  meta: { operation: "s3.objects.get" },
  method: "GET",
  path: "/:bucket/:key",
  input: GetObjectInput,
  builder: (input) => ({
    path: { bucket: input.bucket, key: input.key },
    headers: { "if-none-match": input.ifNoneMatch },
  }),
  output: struct.blob(),
  error: S3Error,
});

export const PutObjectInput = struct.object({
  bucket: struct.string(),
  key: struct.string(),
  body: struct.blob(),
  contentType: struct.string().optional(),
  storageClass: StorageClass.optional(),
});
export type PutObjectInput = Infer<typeof PutObjectInput>;

export const putObject = defineRequest({
  meta: { operation: "s3.objects.put" },
  method: "PUT",
  path: "/:bucket/:key",
  input: PutObjectInput,
  builder: (input) => ({
    path: { bucket: input.bucket, key: input.key },
    headers: {
      "content-type": input.contentType,
      "x-amz-storage-class": input.storageClass,
    },
    body: input.body,
  }),
  error: S3Error,
});
```

```ts
// Consuming application (app.ts): owns the Client and calls SDK operations as pure functions
import {
  createClient,
  createHttpInterceptor,
  withEndpoint,
  withInterceptors,
  withRetry,
  type DerivableClient,
} from "@defjs/core";
import { getObject, listObjectsV2, putObject } from "@company/s3-sdk";

const s3Client = createClient(
  withEndpoint("https://s3.us-east-1.amazonaws.com"),
  withInterceptors(
    createHttpInterceptor((request, next) => {
      const headers = new Headers(request.headers);
      headers.set("authorization", "AWS4-HMAC-SHA256 Credential=...");
      return next({ ...request, headers });
    }),
  ),
  withRetry({ maxRetries: 3 }),
);

export async function syncReport(
  client: DerivableClient,
  bucket: string,
  key: string,
  pdf: Blob,
): Promise<[Error, undefined] | [null, { count: number; size: number }]> {
  const [putErr] = await putObject(client, {
    bucket,
    key,
    body: pdf,
    contentType: "application/pdf",
    storageClass: "STANDARD",
  });
  if (putErr) {
    return [new Error("put object", { cause: putErr }), undefined];
  }

  const [listErr, page] = await listObjectsV2(client, {
    bucket,
    prefix: "reports/",
    maxKeys: 50,
  });
  if (listErr) {
    return [new Error("list objects", { cause: listErr }), undefined];
  }

  const [getErr, blob] = await getObject(
    client({ signal: AbortSignal.timeout(10_000) }),
    { bucket, key },
  );
  if (getErr) {
    return [new Error("get object", { cause: getErr }), undefined];
  }

  return [null, { count: page.contents.length, size: blob.size }];
}

async function main() {
  const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
  const [err, report] = await syncReport(s3Client, "reports", "q3.pdf", pdf);
  if (err) {
    console.error(err);
    return;
  }
  console.log(report.count, report.size);
}

void main();
```

---

## 6. OpenAPI codegen (`@defjs/cli`) and `MessagePort` proxy (`@defjs/core/port`)

- **`@defjs/cli` (dev-only OpenAPI codegen)**: Run `npx @defjs/cli openapi generate` (configured via `defineConfig` in `defjs.config.ts`) or call `generateOpenApi` programmatically. Emits stateless ESM `@defjs/core` definitions (`ts`, `tsx`, `js` + `.d.ts`, `mjs` + `.d.mts`) without binding clients; supports `sync`, `scaffold`, and `--check`. See [docs/integrations/cli](https://defjs.lyz.cloud/llms.mdx/docs/integrations/cli/content.md) and [api/cli](https://defjs.lyz.cloud/llms.mdx/api/cli/content.md).
- **`@defjs/core/port` & `@defjs/core/port/webext` (Worker, iframe, Electron, and MV3 WebExtension proxies)**: Call `withPortTransport(port)` (or `createPortHTTPHandle` / `createPortSSEHandle` / `createPortWebSocketHandle`) inside sandboxed/UI contexts, and `attachPortHost(port, { allowedOrigins: [...] })` on the privileged host. Hosts fail closed unless `allowedOrigins`, `allowRequest`, or `allowAnyOrigin: true` is supplied, and must call `host.close()` (or `using host = ...`). For MV3 `runtime.Port`, adapt with `fromWebExtPort(() => chrome.runtime.connect(...))` on the client and `fromWebExtPort(rawPort)` on the host. See [docs/port](https://defjs.lyz.cloud/llms.mdx/docs/port/content.md) and [api/port](https://defjs.lyz.cloud/llms.mdx/api/port/content.md).

---

## 7. What Defjs intentionally does not provide

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
