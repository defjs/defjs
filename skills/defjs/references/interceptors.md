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

Use a shared refresh flight and recheck the current credential before refreshing. Return the original 401 when the request body is a `ReadableStream`: it cannot be replayed safely. The application owns credential persistence; `refresh` must update the value returned by `read` before resolving.

```ts
import { createHttpInterceptor } from "@defjs/core";

type Credential = { accessToken: string };

function refreshingBearer(
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
    if (current.accessToken !== used.accessToken)
      return next(authorize(current));

    flight ??= refresh(used).finally(() => {
      flight = undefined;
    });
    const refreshed = await flight;
    return next(authorize(refreshed));
  });
}
```

## Retry safe reads with `Retry-After`

Only retry idempotent methods (`GET`, `HEAD`, `OPTIONS`) whose body is replayable (not a `ReadableStream`). Always respect `request.signal` while waiting:

`Retry-After` accepts seconds or an HTTP date; waits are capped at 30 seconds, with a 250 ms fallback. Abort signals cancel the wait without another attempt.

```ts
import {
  createHttpInterceptor,
  type HttpRequest,
  type HttpResponse,
} from "@defjs/core";

const retryableMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const retryableStatuses = new Set([429, 502, 503, 504]);

function isReplayable(request: HttpRequest): boolean {
  return (
    typeof ReadableStream === "undefined" ||
    !(request.body instanceof ReadableStream)
  );
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get("retry-after");
  if (!value) return 250;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1_000, 30_000);

  const date = Date.parse(value);
  return Number.isNaN(date)
    ? 250
    : Math.min(Math.max(0, date - Date.now()), 30_000);
}

function waitForRetryAfter(
  response: HttpResponse<unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const delay = retryAfterMs(response);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the value under test is thrown or rejected unchanged
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(done, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the value under test is thrown or rejected unchanged
      reject(signal?.reason);
    };

    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (
    !retryableMethods.has(request.method.toUpperCase()) ||
    !isReplayable(request)
  )
    return next(request);

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request);
    if (!retryableStatuses.has(response.status) || attempt >= 2)
      return response;
    await waitForRetryAfter(response, request.signal);
  }
});
```

## Short-circuiting and ETag caching

An HTTP interceptor can return a synthetic response with `makeResponse({ status, statusText, headers, body, url })` without calling `next`, or replace a `304 Not Modified` response with a cached `200` `HttpResponse`. When returning a synthetic response for a JSON `output` or `error`, include a JSON `content-type` header and pass the already-parsed value as `body`.

## SSE and WebSocket interceptors

- `createSSEInterceptor((request, next) => ...)`: wraps SSE connection startup and returns an `EventStreamHandle`.
- `createWebSocketInterceptor((request, next) => ...)`: wraps WebSocket session startup and returns a `WebSocketSessionLike`.
- Any wrapper or short-circuit handle/session must implement `[Symbol.asyncDispose]()` forwarding to the same `close` / `closed` teardown lifecycle.
- WebSocket interceptors cannot modify subprotocols (`protocols`) or set handshake headers; pass dynamic subprotocol tokens via `client({ protocols })` at the call site.
