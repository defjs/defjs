# Client configuration and derivation (`createClient`)

Contents: [Create and compose](#create-and-compose) · [`DerivableClient` vs `Client` value](#derivableclient-vs-client-value) · [`RequestOptions`](#requestoptions) · [Client option helpers](#client-option-helpers) · [XSRF and cross-origin redirects](#xsrf-and-cross-origin-redirects) · [Server (SSR) vs browser scope](#server-ssr-vs-browser-scope)

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
- For strategy defaults, retry options/budget, and reconnect boundaries, read [load balancing](load-balancing.md).
- When an application talks to multiple external services, create one `createClient(...)` per service. There is no global client.

## `DerivableClient` vs `Client` value

`createClient(...)` returns a `DerivableClient`:

1. It **is** a `Client` with no per-call options, so you can pass it directly: `getOrder(client, { id: 1 })`.
2. It is **callable** with `RequestOptions` to derive a single-call `Client` value: `getOrder(client({ signal }), { id: 1 })`.
3. Calling `client(options)` performs **no I/O** and returns a plain, **non-callable** `Client` value (`client()()` fails to compile).

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

| Field                | Applies to           | Purpose                                                                                                                                                                                   |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal`             | HTTP, SSE, WebSocket | `AbortSignal` for the request, stream, or session                                                                                                                                         |
| `onUploadProgress`   | HTTP                 | `(event: HttpProgressEvent) => void \| Promise<void>`                                                                                                                                     |
| `onDownloadProgress` | HTTP                 | `(event: HttpProgressEvent) => void \| Promise<void>`                                                                                                                                     |
| `beforeConnect`      | WebSocket            | `({ attempt, signal }) => void \| Promise<void>` hook run before each connection attempt                                                                                                  |
| `protocols`          | WebSocket            | `string[]` subprotocols (overrides client and definition `protocols`)                                                                                                                     |
| `heartbeat`          | WebSocket            | `{ intervalMs, message, isAck?, timeoutMs? }`; `timeoutMs` needs `isAck`                                                                                                                  |
| `retry`              | HTTP, SSE, WebSocket | `{ maxRetries?, delayMs?, factor?, maxDelayMs?, jitter?, attemptTimeoutMs?, methods?, shouldRetry? }`; replaces the client policy as a whole, and the HTTP `budget` stays with the client |

- Note: `client({ retry })` applies to HTTP, SSE, and WebSocket alike. It replaces the policy set with `withRetry(...)` for that call; the HTTP `budget` stays with the client.
- `attemptTimeoutMs` is an option of the retry policy and bounds one attempt: HTTP to the end of the response body, SSE to the response headers, WebSocket to `open`. For a time limit without retries write `withRetry({ maxRetries: 0, attemptTimeoutMs })`.
- Retry options are not validated at runtime; TypeScript is the check.

## Client option helpers

| Helper                           | Effect                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withEndpoint(...urls)`          | Base URL candidates for HTTP, SSE, and WebSocket                                                                                                                                                                                                                                                                              |
| `withBalancer(strategy)`         | Shared endpoint selection strategy; defaults to sticky pick-first                                                                                                                                                                                                                                                             |
| `withRetry(options?)`            | Opt-in retries for HTTP, SSE, and WebSocket: `maxRetries`, backoff, `methods`, `attemptTimeoutMs`, `shouldRetry`, and the HTTP `budget`                                                                                                                                                                                       |
| `withHeaders(HeadersInit)`       | Static default headers for HTTP and SSE (builder headers override)                                                                                                                                                                                                                                                            |
| `withCredentials(boolean)`       | Sets Fetch `credentials: "include"` for HTTP and SSE when `true`                                                                                                                                                                                                                                                              |
| `withXSRF(options?)`             | From `@defjs/core/xsrf`. In a browser, copies the XSRF cookie into a header on mutating same-origin HTTP requests. Calling `withXSRF()` throws when `location` or `document` is missing, including in a Worker. Isomorphic code adds this option only in the browser. A token from another source is set with an interceptor. |
| `withQuerySerializer(fn)`        | Custom serializer `(query) => string` for encoded query objects                                                                                                                                                                                                                                                               |
| `withInterceptors(...items)`     | Appends HTTP, SSE, and WebSocket interceptors in onion order                                                                                                                                                                                                                                                                  |
| `withSSEOnInvalidEvent(fn)`      | Observes undeclared or invalid SSE events                                                                                                                                                                                                                                                                                     |
| `withWebSocketHeartbeat(policy)` | Client-level default WebSocket heartbeat; `message` is required and `timeoutMs` needs `isAck`                                                                                                                                                                                                                                 |
| `withWebSocketProtocols(list)`   | Client-level default WebSocket subprotocols                                                                                                                                                                                                                                                                                   |
| `withWebSocketBeforeConnect(fn)` | Client-level hook before each WebSocket handshake                                                                                                                                                                                                                                                                             |
| `withHTTPHandle(fetch)`          | Replaces Fetch implementation for HTTP (ideal for tests or custom agent)                                                                                                                                                                                                                                                      |
| `withSSEHandle(fetch)`           | Replaces Fetch implementation for SSE                                                                                                                                                                                                                                                                                         |
| `withWebSocketHandle(WebSocket)` | Replaces WebSocket constructor                                                                                                                                                                                                                                                                                                |

## XSRF and cross-origin redirects

`withXSRF` checks the origin of the URL the library builds. Fetch follows redirects itself, and after a redirect to another origin it removes only `Authorization`, so the XSRF header goes along. The target receives the token when it allows the header in its CORS preflight. To refuse that, set `mode: "same-origin"` on requests to the page origin that carry the header:

```ts
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { withXSRF } from "@defjs/core/xsrf";

export const client = createClient(
  withEndpoint("https://app.example.com/api"),
  withHTTPHandle((input, init) => {
    const request = new Request(input, init);
    const sameOrigin = new URL(request.url).origin === location.origin;
    return fetch(
      sameOrigin && request.headers.has("X-XSRF-TOKEN")
        ? new Request(request, { mode: "same-origin" })
        : request,
    );
  }),
  withXSRF(),
);
```

Such a request fails with `NET_UNREACHABLE` when a redirect leaves the origin, and still follows a same-origin redirect. The origin check keeps the mode off a cross-origin API whose header comes from an interceptor, because Fetch rejects any request to another origin in that mode. With `Referrer-Policy: no-referrer`, Fetch sends `Origin: null` for a same-origin POST in that mode, where the default mode sends the serialized origin, so a server that checks `Origin` can reject it. Some engines implement this differently. Do not use `redirect: "error"` instead: it also fails same-origin redirects.

## Server (SSR) vs browser scope

- **Browser:** share a module-scoped `client` when endpoint, interceptors, and credentials are browser-safe and request-independent.
- **Server / SSR:** whenever client options or interceptor closures capture per-request auth tokens, cookies, tenant IDs, or user context, create the client **inside the incoming request boundary** so state never leaks across concurrent requests.
