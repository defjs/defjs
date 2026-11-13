# Client Configuration, Load Balancing, Retries, and Interceptors

Contents: [Client creation and `DerivableClient` scope](#1-client-creation-and-derivableclient-scope) · [`RequestOptions` and client helpers](#2-requestoptions-and-client-helpers) · [Browser XSRF protection](#3-browser-xsrf-protection) · [Multiple endpoints and load balancing](#4-multiple-endpoints-and-load-balancing) · [Unified retry policy (`withRetry`)](#5-unified-retry-policy-withretry) · [HTTP interceptors and the 4 standard recipes](#6-http-interceptors-and-the-4-standard-recipes)

For full English guide pages on the official site (no locale prefix), fetch `https://defjs.lyz.cloud/llms.mdx/docs/client/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/load-balancing/content.md`, and `https://defjs.lyz.cloud/llms.mdx/docs/interceptors/content.md`.

---

## 1. Client creation and `DerivableClient` scope

`createClient(...options)` returns a `DerivableClient`:

1. Pass it directly to an operation when no per-call options are needed: `getOrder(client, { id: 1 })`.
2. Call `client(requestOptions)` inline to derive a single-call, **non-callable** `Client` value: `getOrder(client({ signal }), { id: 1 })`. Calling `client(options)` performs no I/O.
3. **Browser vs SSR scope**:
   - **Browser**: Create one module-scoped `client` per upstream service and share it across the app so balancer state and the HTTP retry budget are preserved.
   - **Server / SSR**: Whenever headers, cookies, auth tokens, or tenant context differ per incoming request, call `createClient(...)` **inside the incoming request handler** so credentials never leak across concurrent requests.

```ts
// Wrong: reusing a derived client with a timeout signal across calls
const derived = client({ signal: AbortSignal.timeout(5_000) });
await getOrder(derived, { id: 1 });
await getOrder(derived, { id: 2 }); // shares the already-ticking or expired signal!

// Right: derive inline per call
await getOrder(client({ signal: AbortSignal.timeout(5_000) }), { id: 1 });
await getOrder(client({ signal: AbortSignal.timeout(5_000) }), { id: 2 });
```

---

## 2. `RequestOptions` and client helpers

`client(options)` accepts 7 flat fields; each protocol reads only the fields that apply to it:

| `RequestOptions` field | Applies to           | Behavior                                                                                                                                     |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal`               | HTTP, SSE, WebSocket | `AbortSignal` for the request, entire SSE stream lifetime, or entire WebSocket session lifetime                                              |
| `onUploadProgress`     | HTTP                 | `(event: HttpProgressEvent) => void \| Promise<void>` (called only for `ReadableStream` bodies)                                              |
| `onDownloadProgress`   | HTTP                 | `(event: HttpProgressEvent) => void \| Promise<void>`                                                                                        |
| `beforeConnect`        | WebSocket            | `({ attempt, signal }) => void \| Promise<void>` hook run before each WebSocket connection attempt                                           |
| `protocols`            | WebSocket            | `string[]` subprotocols (overrides `withWebSocketProtocols` and `defineWebSocket` `protocols`)                                               |
| `heartbeat`            | WebSocket            | `{ intervalMs, message, isAck?, timeoutMs? }`; `timeoutMs` requires `isAck`                                                                  |
| `retry`                | HTTP, SSE, WebSocket | `{ maxRetries?, delayMs?, factor?, maxDelayMs?, jitter?, attemptTimeoutMs?, methods?, shouldRetry? }` (replaces client policy for this call) |

Client configuration helpers passed to `createClient(...)`:

| Helper                           | Purpose                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `withEndpoint(...urls)`          | One or more base URLs (pathname is treated as a base directory; query/hash are stripped; `../` traversal is blocked) |
| `withBalancer(strategy)`         | Endpoint selection strategy (`pickFirstBalancer()` by default)                                                       |
| `withRetry(options?)`            | Opt-in retries for HTTP, SSE, and WebSocket, plus the client-level HTTP `budget`                                     |
| `withHeaders(HeadersInit)`       | Static default headers for HTTP and SSE (`builder` headers override)                                                 |
| `withCredentials(boolean)`       | Sets Fetch `credentials: "include"` for HTTP and SSE when `true`                                                     |
| `withXSRF(options?)`             | From `@defjs/core/xsrf` (browser-only); copies the XSRF cookie into a header on mutating same-origin HTTP requests   |
| `withQuerySerializer(fn)`        | Custom `(query) => string` serializer for object queries                                                             |
| `withInterceptors(...items)`     | Appends HTTP, SSE, and WebSocket interceptors in onion order                                                         |
| `withSSEOnInvalidEvent(fn)`      | Observer for undeclared or struct-invalid SSE events                                                                 |
| `withWebSocketHeartbeat(policy)` | Default WebSocket heartbeat (`message` required; `timeoutMs` requires `isAck`)                                       |
| `withWebSocketProtocols(list)`   | Default WebSocket subprotocols                                                                                       |
| `withWebSocketBeforeConnect(fn)` | Default hook run before each WebSocket handshake                                                                     |
| `withHTTPHandle(fetch)`          | Custom Fetch implementation for HTTP (used for tests or custom transport options)                                    |
| `withSSEHandle(fetch)`           | Custom Fetch implementation for SSE                                                                                  |
| `withWebSocketHandle(WebSocket)` | Custom WebSocket constructor                                                                                         |

---

## 3. Browser XSRF protection

Import `withXSRF` from `@defjs/core/xsrf`. Calling `withXSRF()` throws immediately when `location` or `document` is missing (such as in SSR or a Web Worker), so add it only in browser code.

Because Fetch strips only `Authorization` on cross-origin redirects, a redirected same-origin request would carry `X-XSRF-TOKEN` to another origin. To prevent XSRF token leakage across cross-origin redirects while still allowing same-origin redirects, wrap `fetch` with `mode: "same-origin"` when the XSRF header is present:

### Best practice: browser client with XSRF and cross-origin redirect guard

```ts
import {
  createClient,
  withCredentials,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";
import { withXSRF } from "@defjs/core/xsrf";

export const browserClient = createClient(
  withEndpoint("https://app.example.com/api"),
  withCredentials(true),
  withHTTPHandle((input, init) => {
    const request = new Request(input, init);
    const sameOrigin = new URL(request.url).origin === location.origin;
    return fetch(
      sameOrigin && request.headers.has("X-XSRF-TOKEN")
        ? new Request(request, { mode: "same-origin" })
        : request,
    );
  }),
  withXSRF({ cookieName: "XSRF-TOKEN", headerName: "X-XSRF-TOKEN" }),
);
```

---

## 4. Multiple endpoints and load balancing

Pass multiple replicas of the **same** service to `withEndpoint(...urls)` and choose a strategy with `withBalancer(...)`:

| Strategy                            | Best practice & behavior                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pickFirstBalancer(options?)`       | Default. Sticky primary/backup; advances on attributed `NET_UNREACHABLE` or `NET_UNAVAILABLE` (not timeout). Optional `failbackMs` returns to primary. |
| `roundRobinBalancer(options?)`      | Cyclic selection (optional `weights: ReadonlyMap<string, number>` for smooth weighted round-robin). Pair with `outlierDetection` when retrying.        |
| `p2cBalancer(options?)`             | Power of Two Choices using PeakEwma RTT × (pending + 1) or `load: "pending"`. Pair with `outlierDetection` to eject failing replicas.                  |
| `outlierDetection(child, options?)` | Ejects endpoints after `consecutiveFailures` (default `5`); falls back to all candidates if every replica is ejected.                                  |

### Best practice: multi-region client with P2C load balancing and outlier detection

```ts
import {
  createClient,
  ERR_NO_CANDIDATE,
  isNoCandidateCause,
  p2cBalancer,
  withBalancer,
  withEndpoint,
  withRetry,
  type AnyFault,
  type Balancer,
} from "@defjs/core";

export const balancedClient = createClient(
  withEndpoint(
    "https://us-east.api.example.com",
    "https://us-west.api.example.com",
  ),
  withBalancer(
    p2cBalancer({
      outlierDetection: { consecutiveFailures: 3, minPenaltyMs: 2_000 },
    }),
  ),
  withRetry({ maxRetries: 2 }),
);

// Custom synchronous balancer contract: never mutate endpoints, never return a Promise
export const firstHealthyBalancer: Balancer = {
  pick({ endpoints }) {
    const endpoint = endpoints[0];
    if (endpoint === undefined) return [ERR_NO_CANDIDATE, undefined];
    return [null, { endpoint }];
  },
};

export function isEmptyCandidatePool(fault: AnyFault): boolean {
  return fault.code === "REQ_BUILD_FAILED" && isNoCandidateCause(fault.cause);
}
```

---

## 5. Unified retry policy (`withRetry`)

Without `withRetry`, every operation runs at most 1 attempt. `withRetry(options?)` enables retries across HTTP, SSE, and WebSocket:

- **Defaults**: `maxRetries: 3`, `delayMs: 1000`, `factor: 2`, `jitter: 0.2`, `maxDelayMs: 30000`, `methods: ["GET", "HEAD", "OPTIONS", "TRACE", "PUT", "DELETE"]`, HTTP `budget: { percentCanRetry: 0.2, minRetriesPerSecond: 10, ttlMs: 10000 }`.
- **Single-attempt deadline without retries**: `attemptTimeoutMs` bounds one attempt (HTTP to end of response body, SSE to response headers, WebSocket to `open`). Because `maxRetries` defaults to `3`, write `withRetry({ maxRetries: 0, attemptTimeoutMs: 3_000 })` when you want a per-attempt deadline with zero retries.
- **Default `context.retryable`**:
  - **HTTP**: Method is in `methods` AND outcome is connection failure, `502`/`503`/`504`, or `attemptTimeoutMs` timeout (`ReadableStream` bodies are never retried). Each retry re-picks an endpoint, rebuilds the request, and re-runs the full interceptor chain.
  - **SSE**: Method is in `methods` AND handshake/stream network failure, `502`/`503`/`504` handshake, or attempt timeout (clean server EOF ends the stream normally). `maxRetries` resets on each successful open.
  - **WebSocket**: Every close not initiated by `session.close()` (including failed initial handshakes and heartbeat timeouts). `maxRetries` resets on each successful open.

### Best practice: custom `shouldRetry` across HTTP, SSE, and WebSocket

```ts
import { createClient, withEndpoint, withRetry } from "@defjs/core";

export const resilientClient = createClient(
  withEndpoint("https://api.example.com"),
  withRetry({
    maxRetries: 3,
    attemptTimeoutMs: 5_000,
    shouldRetry(context) {
      if (context.transport === "websocket") {
        // Stop on policy violation (1008); retry other unexpected closes
        return context.code !== 1008;
      }
      return context.retryable;
    },
  }),
);
```

---

## 6. HTTP interceptors and the 4 standard recipes

Register interceptors with `withInterceptors(...)`. The first registered interceptor is the outermost layer; calling `next(request)` runs the inner interceptors and the transport.

- `request.body` is already serialized to wire format (`string` for JSON), and `request.bodyContentType` holds the inferred `Content-Type`.
- `request.query` is the mutable `URLSearchParams` instance sent on the wire.

### Best practice 1: Bearer token injection

```ts
import {
  createClient,
  createHttpInterceptor,
  withEndpoint,
  withInterceptors,
} from "@defjs/core";

declare function readAccessToken(): string | undefined;

export const bearerAuth = createHttpInterceptor((request, next) => {
  const token = readAccessToken();
  if (!token) return next(request);

  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return next({ ...request, headers });
});

export const authClient = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(bearerAuth),
);
```

### Best practice 2: Single-flight 401 token refresh and replay

Share one in-flight `refresh` promise across concurrent 401 responses, recheck whether another caller already rotated the token, and never replay a `ReadableStream` body:

```ts
import { createHttpInterceptor } from "@defjs/core";

export type Credential = { accessToken: string };

export function refreshingBearer(
  read: () => Credential,
  refresh: (stale: Credential) => Promise<Credential>,
) {
  let flight: Promise<Credential> | undefined;

  return createHttpInterceptor(async (request, next) => {
    const authorize = (credential: Credential) => {
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${credential.accessToken}`);
      return { ...request, headers };
    };

    const used = read();
    const response = await next(authorize(used));
    const body = response.body;
    if (
      (typeof ReadableStream !== "undefined" &&
        request.body instanceof ReadableStream) ||
      response.status !== 401 ||
      typeof body !== "object" ||
      body === null ||
      !("code" in body) ||
      body.code !== "expired_token"
    ) {
      return response;
    }

    const current = read();
    if (current.accessToken !== used.accessToken) {
      return next(authorize(current));
    }

    flight ??= refresh(used).finally(() => {
      flight = undefined;
    });
    const refreshed = await flight;
    return next(authorize(refreshed));
  });
}
```

### Best practice 3: Honor `429 Retry-After` on the same endpoint

Core `withRetry` handles `502`/`503`/`504` and network failures; `429 Retry-After` is an application interceptor policy that waits while respecting `request.signal`:

```ts
import {
  createHttpInterceptor,
  type HttpRequest,
  type HttpResponse,
} from "@defjs/core";

function isReplayable(request: HttpRequest): boolean {
  return (
    typeof ReadableStream === "undefined" ||
    !(request.body instanceof ReadableStream)
  );
}

function parseRetryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get("retry-after");
  if (!value) return 250;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 30_000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date)
    ? 250
    : Math.min(Math.max(0, date - Date.now()), 30_000);
}

async function waitForRetryAfter(
  response: HttpResponse<unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const delay = parseRetryAfterMs(response);
  signal?.throwIfAborted();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay);
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  signal?.throwIfAborted();
}

export const honorRetryAfter = createHttpInterceptor(async (request, next) => {
  if (!isReplayable(request)) return next(request);
  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request);
    if (response.status !== 429 || attempt >= 2) return response;
    await waitForRetryAfter(response, request.signal);
  }
});
```

### Best practice 4: ETag revalidation (`304 Not Modified`) and `makeResponse`

Do **not** rewrite a `304 Not Modified` into a synthetic `200` inside an interceptor. A `304` has no body and reaches the call site as an `HTTP_STATUS` fault (`error.status === 304`), where the application's cache reader returns its cached value. Use `makeResponse` only when intentionally short-circuiting a request before transport:

```ts
import { defineRequest, makeResponse, struct, type Client } from "@defjs/core";

const getOrderWithEtag = defineRequest({
  method: "GET",
  meta: { operation: "orders.get" },
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    ifNoneMatch: struct.string().optional(),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "if-none-match": input.ifNoneMatch },
  }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

export function makeOrderReader(client: Client) {
  let cached:
    { etag: string; value: { id: number; status: string } } | undefined;

  return async (id: number) => {
    const [error, order, response] = await getOrderWithEtag(client, {
      id,
      ifNoneMatch: cached?.etag,
    });
    if (error?.code === "HTTP_STATUS" && error.status === 304 && cached) {
      return [null, cached.value] as const;
    }
    if (error) return [error, undefined] as const;
    const etag = response.headers.get("etag");
    if (etag) cached = { etag, value: order };
    return [null, order] as const;
  };
}

// Synthetic short-circuit response helper inside an HTTP interceptor when needed:
export const syntheticResponseExample = makeResponse({
  status: 200,
  statusText: "OK",
  headers: new Headers({ "content-type": "application/json" }),
  body: { id: 1, status: "paid" },
  url: "https://api.example.com/orders/1",
});
```
