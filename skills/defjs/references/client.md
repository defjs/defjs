# Client configuration and derivation (`createClient`)

Contents: [Create and compose](#create-and-compose) · [`DerivableClient` vs `Client` value](#derivableclient-vs-client-value) · [`RequestOptions`](#requestoptions) · [Client option helpers](#client-option-helpers) · [Server (SSR) vs browser scope](#server-ssr-vs-browser-scope)

## Create and compose

The consuming application owns the client: base endpoint, credentials, headers, interceptors, and transport handles.

```ts
import {
  createClient,
  withCredentials,
  withEndpoint,
  withHeaders,
} from "@defjs/core";
import { withXSRF } from "@defjs/core/xsrf";

export const client = createClient(
  withEndpoint("https://api.example.com/v1"),
  withHeaders({ "x-client-info": "orders-web" }),
  withCredentials(true),
  withXSRF({
    cookieName: "XSRF-TOKEN",
    headerName: "X-XSRF-TOKEN",
  }),
);
```

- `withEndpoint(...urls)` sets one or more base URLs for replicas of one service. Its pathname is treated as a directory; query and hash on the base URL are dropped. Joining `https://api.example.com/v1` with `/orders/7` produces `https://api.example.com/v1/orders/7`. Path traversal outside the base directory (`../other`) fails with `REQ_BUILD_FAILED`.
- For strategy defaults, HTTP retry options/budget, and reconnect boundaries, read [load balancing](load-balancing.md).
- When an application talks to multiple external services, create one `createClient(...)` per service. There is no global client.

## `DerivableClient` vs `Client` value

`createClient(...)` returns a `DerivableClient`:

1. It **is** a `Client` with no per-call options, so you can pass it directly: `getOrder(client, { id: 1 })`.
2. It is **callable** with `RequestOptions` to derive a single-call `Client` value: `getOrder(client({ signal }), { id: 1 })`.
3. Calling `client(options)` performs **no I/O** and returns a plain, **non-callable** `Client` value (`client()()` fails to compile and throws a `TypeError` at runtime).

```ts
// Incorrect: sharing a derived client that holds a single-request signal
const derived = client({ signal: AbortSignal.timeout(5_000) });
await getOrder(derived, { id: 1 });
await getOrder(derived, { id: 2 }); // reuses the same timeout signal!

// Correct: derive at each call site
await getOrder(client({ signal: AbortSignal.timeout(5_000) }), { id: 1 });
await getOrder(client({ signal: AbortSignal.timeout(5_000) }), { id: 2 });
```

## `RequestOptions`

`client(options)` accepts seven flat fields. Each protocol reads only the fields that apply to it and ignores the rest:

| Field                | Applies to           | Purpose                                                                                       |
| -------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| `signal`             | HTTP, SSE, WebSocket | `AbortSignal` for the request, stream, or session                                             |
| `onUploadProgress`   | HTTP                 | `(event: HttpProgressEvent) => void \| Promise<void>`                                         |
| `onDownloadProgress` | HTTP                 | `(event: HttpProgressEvent) => void \| Promise<void>`                                         |
| `beforeConnect`      | WebSocket            | `({ attempt, signal }) => void \| Promise<void>` hook run before each connection attempt      |
| `protocols`          | WebSocket            | `string[]` subprotocols (overrides client and definition `protocols`)                         |
| `heartbeat`          | WebSocket            | `{ intervalMs, timeoutMs?, message, isAck }`                                                  |
| `reconnect`          | WebSocket            | `{ attempts?, connectTimeoutMs?, delayMs?, factor?, maxDelayMs?, jitter?, shouldReconnect? }` |

- Note: `client({ reconnect })` configures **WebSocket** reconnect only. SSE reconnect is configured on the client with `withSSEReconnect(...)`.
- `connectTimeoutMs` exists only inside a reconnect options object (`withSSEReconnect`, `withWebSocketReconnect`, `client({ reconnect })`) and bounds each handshake. That object defaults `attempts` to 3, so `connectTimeoutMs` alone also enables automatic reconnect; add `attempts: 0` for a handshake-only deadline.
- Invalid numeric options (such as negative delays) are validated when the operation executes and return a `REQ_OPTIONS_INVALID` fault on the tuple.

## Client option helpers

| Helper                           | Effect                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withEndpoint(...urls)`          | Base URL candidates for HTTP, SSE, and WebSocket                                                                                                                                                                                                                                                                              |
| `withBalancer(strategy)`         | Shared endpoint selection strategy; defaults to sticky pick-first                                                                                                                                                                                                                                                             |
| `withRetry(options?)`            | Opt-in same-call HTTP failover; separate from SSE/WebSocket reconnect                                                                                                                                                                                                                                                         |
| `withHeaders(HeadersInit)`       | Static default headers for HTTP and SSE (builder headers override)                                                                                                                                                                                                                                                            |
| `withCredentials(boolean)`       | Sets Fetch `credentials: "include"` for HTTP and SSE when `true`                                                                                                                                                                                                                                                              |
| `withXSRF(options?)`             | From `@defjs/core/xsrf`. In a browser, copies the XSRF cookie into a header on mutating same-origin HTTP requests. Calling `withXSRF()` throws when `location` or `document` is missing, including in a Worker. Isomorphic code adds this option only in the browser. A token from another source is set with an interceptor. |
| `withQuerySerializer(fn)`        | Custom serializer `(query) => string` for encoded query objects                                                                                                                                                                                                                                                               |
| `withInterceptors(...items)`     | Appends HTTP, SSE, and WebSocket interceptors in onion order                                                                                                                                                                                                                                                                  |
| `withSSEReconnect(policy)`       | Enables opt-in SSE reconnection                                                                                                                                                                                                                                                                                               |
| `withSSEOnInvalidEvent(fn)`      | Observes undeclared or invalid SSE events                                                                                                                                                                                                                                                                                     |
| `withWebSocketReconnect(policy)` | Client-level default WebSocket reconnect policy                                                                                                                                                                                                                                                                               |
| `withWebSocketHeartbeat(policy)` | Client-level default WebSocket heartbeat policy                                                                                                                                                                                                                                                                               |
| `withWebSocketProtocols(list)`   | Client-level default WebSocket subprotocols                                                                                                                                                                                                                                                                                   |
| `withWebSocketBeforeConnect(fn)` | Client-level hook before each WebSocket handshake                                                                                                                                                                                                                                                                             |
| `withHTTPHandle(fetch)`          | Replaces Fetch implementation for HTTP (ideal for tests or custom agent)                                                                                                                                                                                                                                                      |
| `withSSEHandle(fetch)`           | Replaces Fetch implementation for SSE                                                                                                                                                                                                                                                                                         |
| `withWebSocketHandle(WebSocket)` | Replaces WebSocket constructor                                                                                                                                                                                                                                                                                                |

## Server (SSR) vs browser scope

- **Browser:** share a module-scoped `client` when endpoint, interceptors, and credentials are browser-safe and request-independent.
- **Server / SSR:** whenever client options or interceptor closures capture per-request auth tokens, cookies, tenant IDs, or user context, create the client **inside the incoming request boundary** so state never leaks across concurrent requests.
