# Client [#client]

A `Client` holds the consuming application's execution configuration: base URLs, default headers, credentials, interceptors, query serialization, and transport handles.

`createClient(...options)` returns a [`DerivableClient`](/api/core/derivableclient-type):

- Pass `client` directly to an operation (`getOrder(client, { id: 1 })`) when no per-call request options are needed.
- Call `client(requestOptions)` to derive a client value for one call (`getOrder(client({ signal }), { id: 1 })`). Deriving performs no I/O, and the derived value is a plain object (not callable).

## 1. Configure a client and call an SDK operation [#1-configure-a-client-and-call-an-sdk-operation]

<Tabs items={["sdk/orders.ts", "app/client.ts", "Composed client options"]}>
<Tab>

```typescript
import { defineRequest, struct } from "@defjs/core";

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

</Tab>
<Tab>

```typescript
import { createClient, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
```

</Tab>
<Tab>

```typescript
import {
  createClient,
  createHttpInterceptor,
  withCredentials,
  withEndpoint,
  withInterceptors,
} from "@defjs/core";

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now();
  const response = await next(request);
  console.info(
    request.operation ?? request.method,
    response.status,
    Math.round(performance.now() - started),
  );
  return response;
});

const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(audit),
  withCredentials(true),
);
```

</Tab>
</Tabs>

### Option composition rules [#option-composition-rules]

- Options apply **left to right**.
- Single-value setters (`withEndpoint`, `withHeaders`, `withQuerySerializer`, `withCredentials`, and `withXSRF` from `@defjs/core/xsrf`) **replace** earlier values.
- `withInterceptors(...items)` **appends** to the existing interceptor list and filters by transport (`http`, `sse`, `web-socket`) when an operation runs.

## 2. Derive a per-call client (`client(options)`) [#2-derive-a-per-call-client-clientoptions]

Create a new derived client value for each call that needs its own `signal`, progress callbacks, or WebSocket session overrides:

```typescript
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

async function main(signal: AbortSignal) {
  const requestClient = client({
    signal,
    onDownloadProgress(event) {
      console.log(event.loaded);
    },
  });
  const [error, order] = await getOrder(requestClient, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}
```

> [!IMPORTANT]
> Because `createClient(...)` returns a callable function (`DerivableClient`), do **not** pass it directly to a React `setState(client)` updater or a Vue `watch(client)` / `computed(client)` source, which treat functions as updaters or getters.

### Per-call `RequestOptions` reference [#per-call-requestoptions-reference]

`RequestOptions` has seven flat fields. Each transport reads only the fields that apply to it and ignores the rest:

| Field                | Used by              | Behavior                                                                                       |
| -------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `signal`             | HTTP, SSE, WebSocket | Aborts the call (`AbortSignal.timeout(ms)` → `NET_TIMEOUT`; manual abort → `NET_ABORTED`).     |
| `onUploadProgress`   | HTTP                 | Reports streaming request-body upload progress.                                                |
| `onDownloadProgress` | HTTP                 | Reports declared response-body download progress.                                              |
| `beforeConnect`      | WebSocket            | Replaces the client-level `beforeConnect` hook for this session.                               |
| `protocols`          | WebSocket            | Replaces the client-level subprotocol list for this session.                                   |
| `heartbeat`          | WebSocket            | Replaces the client-level heartbeat configuration for this session.                            |
| `retry`              | HTTP, SSE, WebSocket | Replaces the client-level retry policy for this call. The HTTP `budget` stays with the client. |

## 3. Browser singleton vs. server request scope [#3-browser-singleton-vs-server-request-scope]

- **Browser applications**: Share a single module-scoped `DerivableClient` when the endpoint, interceptors, and credentials are browser-wide.
- **Server / SSR applications**: Create a fresh client **inside each inbound request boundary** whenever headers, cookies, auth tokens, or tenant context are request-specific. Never store per-user credentials on a process-wide client.

## 4. Multiple endpoints and load balancing [#multiple-endpoints]

`withEndpoint(...urls)` accepts one or more candidate base URLs. By default:

- Each client uses [`pickFirstBalancer`](/api/core/pickfirstbalancer), sticking to the first URL until it advances on `NET_UNREACHABLE` or `NET_UNAVAILABLE` (HTTP 502, 503, or 504).
- **Retries are off by default.** A call makes one attempt. `withRetry()` is equivalent to `withRetry({})`: up to three retries with backoff, for HTTP, SSE, and WebSocket alike. After each failure the balancer picks again from every endpoint, so a retry after a refused connection reaches the next endpoint under pick-first, and a single endpoint is tried again after the delay. The HTTP Finagle retry budget belongs to the client configuration and is shared by its derived clients, independently of balancer identity.

```typescript
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const client = createClient(
  withEndpoint("https://api-us.example.com", "https://api-eu.example.com"),
);

async function main() {
  const [error, order] = await getOrder(client, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
```

`attemptTimeoutMs` bounds one attempt: HTTP counts to the end of the response body, SSE to the response headers, WebSocket to `open`. For a time limit without retries write `withRetry({ maxRetries: 0, attemptTimeoutMs })`. Retry options are not validated at runtime. See [Load balancing & failover](/docs/load-balancing#retries) for the decision order and the migration from `withSSEReconnect` and `withWebSocketReconnect`.

### Health filtering and p2c [#health-filtering-and-p2c]

For peer server replicas, [`roundRobinBalancer`](/api/core/roundrobinbalancer) and [`p2cBalancer`](/api/core/p2cbalancer) (PeakEwma RTT × in-flight load) can take an `outlierDetection` option; it is off unless you pass an object (`{}` for the defaults). It counts failures and ejects an endpoint for a while, and it skips an endpoint that your own `isHealthy` function rejects; Defjs does not decide what healthy means. By default every coded outcome counts as a failure (including `NET_TIMEOUT` and `NET_BODY_INCOMPLETE`), and you can replace that rule with `isFailure`; raw response `status` is only for custom balancers.

See the dedicated [Load balancing & failover](/docs/load-balancing) guide for full details on retry budgets, failure ejection and your own health function, P2C load estimation, and custom balancers.

## 5. Inject a test transport [#5-inject-a-test-transport]

Replace platform `fetch` or `WebSocket` on a client with `withHTTPHandle`, `withSSEHandle`, or `withWebSocketHandle` to run full contract tests offline:

```typescript
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(() =>
    Promise.resolve(Response.json({ id: 7, status: "paid" })),
  ),
);
async function main() {
  const [error, order] = await getOrder(client, { id: 7 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
```

See [Testing](/docs/testing) for complete testing patterns.

## 6. Client option helpers reference [#6-client-option-helpers-reference]

| Helper                                                                             | Purpose                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withEndpoint(...urls)`                                                            | Sets one or more candidate base URLs (replaces earlier list).                                                                                                                                                                                                                                                                 |
| `withHeaders(HeadersInit)`                                                         | Sets static default headers for HTTP and SSE (builder headers override).                                                                                                                                                                                                                                                      |
| `withInterceptors(...items)`                                                       | Appends HTTP, SSE, and WebSocket interceptors in onion order.                                                                                                                                                                                                                                                                 |
| `withQuerySerializer(fn)`                                                          | Serializes already-aliased query objects into a query string.                                                                                                                                                                                                                                                                 |
| `withCredentials(boolean)`                                                         | Sets Fetch `credentials: "include"` for HTTP and SSE when `true`.                                                                                                                                                                                                                                                             |
| `withXSRF(options?)`                                                               | From `@defjs/core/xsrf`. In a browser, copies the XSRF cookie into a header on same-origin mutating HTTP requests. Calling `withXSRF()` throws when `location` or `document` is missing, including in a Worker. Isomorphic code adds this option only in the browser. A token from another source is set with an interceptor. |
| `withBalancer(balancer)`                                                           | Replaces the endpoint selection strategy (`pickFirstBalancer`, `roundRobinBalancer`, `p2cBalancer`).                                                                                                                                                                                                                          |
| `withRetry(options?)`                                                              | Configures opt-in retries for HTTP, SSE, and WebSocket: retry count, backoff, methods, attempt timeout, a `shouldRetry` function, and the HTTP client-owned budget.                                                                                                                                                           |
| `withSSEOnInvalidEvent`                                                            | Observes SSE events that have no struct or fail validation.                                                                                                                                                                                                                                                                   |
| `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | Configures WebSocket session defaults.                                                                                                                                                                                                                                                                                        |
| `withHTTPHandle` / `withSSEHandle` / `withWebSocketHandle`                         | Injects custom or mock transport implementations.                                                                                                                                                                                                                                                                             |

## Related reading [#related-reading]

- [Load balancing & failover](/docs/load-balancing)
- [Interceptors](/docs/interceptors)
- [Testing](/docs/testing)
- [Test with a local Fetch handle](/recipes/test-with-handle)
