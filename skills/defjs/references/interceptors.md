# Interceptors (`createHttpInterceptor`, SSE, WebSocket)

Contents: [Onion model and registration](#onion-model-and-registration) · [Auth header injection](#auth-header-injection) · [Refresh bearer token once on 401](#refresh-bearer-token-once-on-401) · [Retry safe reads with `Retry-After`](#retry-safe-reads-with-retry-after) · [Short-circuiting and ETag caching](#short-circuiting-and-etag-caching) · [SSE and WebSocket interceptors](#sse-and-websocket-interceptors)

## Onion model and registration

Register HTTP, SSE, and WebSocket interceptors with `withInterceptors(...)`.

- The first registered interceptor is the outermost layer; `next(request)` runs only the interceptors registered **after** the current one and then the transport handler.
- Calling `next(request)` a second time inside the same interceptor replays the inner chain without re-running outer interceptors.
- Once the chain has settled, calling `next` again rejects.

## Auth header injection

Put authentication, tenant headers, and request signing in an interceptor, never in `builder`:

```ts
import {
  createClient,
  createHttpInterceptor,
  withEndpoint,
  withInterceptors,
} from "@defjs/core";

declare function readAccessToken(): string | undefined;

const bearerAuth = createHttpInterceptor((request, next) => {
  const token = readAccessToken();
  if (!token) return next(request);

  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return next({ ...request, headers });
});

export const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(bearerAuth),
);
```

- HTTP interceptors see explicit headers only; Defjs applies automatic `Content-Type` headers right before sending.
- `request.queryParams` is a `URLSearchParams` view; to change the outgoing URL or headers, pass a modified copy to `next({ ...request, headers })`.

## Refresh bearer token once on 401

```ts
import { createHttpInterceptor } from "@defjs/core";

declare function getAccessToken(): Promise<string>;
declare function refreshAccessToken(): Promise<string>;

export const refreshBearerOnce = createHttpInterceptor(
  async (request, next) => {
    const withToken = (token: string) => {
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return { ...request, headers };
    };

    const firstResponse = await next(withToken(await getAccessToken()));
    if (firstResponse.status !== 401) return firstResponse;

    const freshToken = await refreshAccessToken();
    return next(withToken(freshToken));
  },
);
```

## Retry safe reads with `Retry-After`

Only retry idempotent methods (`GET`, `HEAD`, `OPTIONS`) whose body is replayable (not a `ReadableStream`). Always respect `request.signal` while waiting:

```ts
import {
  createHttpInterceptor,
  type HttpRequest,
  type HttpResponse,
} from "@defjs/core";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

function isReplayable(request: HttpRequest): boolean {
  return (
    typeof ReadableStream === "undefined" ||
    !(request.body instanceof ReadableStream)
  );
}

function waitWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const retrySafeReads = createHttpInterceptor(
  async (request, next): Promise<HttpResponse<unknown>> => {
    if (
      !SAFE_METHODS.has(request.method.toUpperCase()) ||
      !isReplayable(request)
    )
      return next(request);

    for (let attempt = 0; ; attempt += 1) {
      const response = await next(request);
      if (!RETRY_STATUSES.has(response.status) || attempt >= 2) return response;
      await waitWithSignal(250 * (attempt + 1), request.signal);
    }
  },
);
```

## Short-circuiting and ETag caching

An HTTP interceptor can return a synthetic response with `makeResponse({ status, statusText, headers, body, url })` without calling `next`, or replace a `304 Not Modified` response with a cached `200` `HttpResponse`. When returning a synthetic response for a JSON `output` or `error`, include a JSON `content-type` header and pass the already-parsed value as `body`.

## SSE and WebSocket interceptors

- `createSSEInterceptor((request, next) => ...)`: wraps SSE connection startup and returns an `EventStreamHandle`.
- `createWebSocketInterceptor((request, next) => ...)`: wraps WebSocket session startup and returns a `WebSocketSessionLike`.
- Any wrapper or short-circuit handle/session must implement `[Symbol.asyncDispose]()` forwarding to the same `close` / `closed` teardown lifecycle.
- WebSocket interceptors cannot modify subprotocols (`protocols`) or set handshake headers; pass dynamic subprotocol tokens via `client({ protocols })` at the call site.
