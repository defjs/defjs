# Interceptors [#interceptors]

Interceptors attach cross-cutting execution policies—authentication headers, request signing, maintenance short-circuiting, or `Retry-After` handling—to the application's `Client` without modifying SDK operation definitions.

Input validation and `builder` mapping run **before** the interceptor chain; HTTP status dispatch and `output` / `error` struct validation run **after** the chain.

## 1. Create and register an interceptor [#1-create-and-register-an-interceptor]

Each transport has its own typed interceptor factory (`createHttpInterceptor`, `createSSEInterceptor`, `createWebSocketInterceptor`). Pass any combination to `withInterceptors(...)`:

<Tabs items={["Basic setup", "Onion execution order", "Clone & add headers"]}>
<Tab>

```typescript
import {
  createClient,
  createHttpInterceptor,
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
);
```

</Tab>
<Tab>

```typescript
import { createHttpInterceptor } from "@defjs/core";

const order: string[] = [];
const first = createHttpInterceptor(async (request, next) => {
  order.push("first:before");
  const response = await next(request);
  order.push("first:after");
  return response;
});

const second = createHttpInterceptor(async (request, next) => {
  order.push("second:before");
  const response = await next(request);
  order.push("second:after");
  return response;
});

// Request: first:before → second:before → transport
// Return: second:after → first:after
```

</Tab>
<Tab>

```typescript
import { createHttpInterceptor } from "@defjs/core";

function readAccessToken(): string | undefined {
  return undefined;
}

const bearer = createHttpInterceptor((request, next) => {
  const token = readAccessToken();
  if (!token) return next(request);

  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return next({ ...request, headers });
});
```

</Tab>
</Tabs>

### Interceptor pipeline rules [#interceptor-pipeline-rules]

- **Onion order**: Interceptors run in registration order on the way out (`before next(req)`) and in reverse order on the way back (`after await next(req)`). Place broad logging/tracing interceptors outside narrower auth or retry interceptors.
- **Immutable request convention**: Always clone `req.headers` (`new Headers(req.headers)`) and pass a new request object (`{ ...req, headers }`) to `next(...)` so outer retries see clean headers.
- **`content-type` and `bodyContentType`**: Defjs stores its inferred body content type on `req.bodyContentType` without mutating `req.headers`. Request signers should read `req.headers.get("content-type") ?? req.bodyContentType`. If an interceptor replaces `req.body` with a new format, set an explicit `content-type` header.

## 2. Short-circuit a request with `makeResponse` [#2-short-circuit-a-request-with-makeresponse]

An HTTP interceptor can return a synthetic response without calling `next(req)` by constructing one with `makeResponse(...)`:

```typescript
import { createHttpInterceptor, makeResponse } from "@defjs/core";

function isMaintenanceWindow(): boolean {
  return false;
}

const maintenanceGate = createHttpInterceptor(async (_request, next) => {
  if (isMaintenanceWindow()) {
    return makeResponse({
      status: 503,
      statusText: "Service Unavailable",
      headers: new Headers({ "content-type": "application/json" }),
      body: { message: "Temporarily unavailable" },
    });
  }

  return next(_request);
});
```

`makeResponse` is **not** a validation bypass: the synthetic response still goes through the operation's media-type check, status fork (`2xx` vs non-`2xx`), and `output` / `error` struct validation.

## 3. Retries and `Retry-After` [#3-retries-and-retry-after]

HTTP retries are off by default. To retry a connection failure, a timeout, or a `502`, `503`, or `504` on another endpoint, use [`withRetry()`](/docs/load-balancing#retries). After the backoff delay it lets the balancer pick again, rebuilds the request, and reruns the complete interceptor chain.

An application interceptor can instead implement same-endpoint status handling, such as `429` and `Retry-After`:

```typescript
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

async function waitForRetryAfter(
  response: HttpResponse<unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const delay = retryAfterMs(response);
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
  // An abort during the wait ends it early and rejects with the signal's reason.
  signal?.throwIfAborted();
}

const honorRetryAfter = createHttpInterceptor(async (request, next) => {
  if (!isReplayable(request)) return next(request);

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request);
    if (response.status !== 429 || attempt >= 2) return response;
    await waitForRetryAfter(response, request.signal);
  }
});
```

- **Two retry layers**: This `next(request)` loop stays on the selected endpoint and does not rerun the builder or outer interceptors. Connection failures and `502`/`503`/`504` belong to `withRetry`.
- **`Retry-After` policy**: Core `withRetry` does not read this header. The recipe's 30-second cap and 250 ms fallback are application choices. Capping a longer server delay can retry earlier than requested; if that is unacceptable, wait for the full delay or return the response instead.
- **401 writes**: The [Bearer-refresh recipe](/recipes/refresh-bearer-once) can deliver a JSON POST twice. Require authentication rejection before business processing and a stable idempotency key with server-side deduplication, or do not automatically replay writes. Stream request bodies are not replayed.
- **Handling transport rejections**: `next(request)` rejects when a network error occurs (there is no status-0 response). Catching and rethrowing that rejection preserves the original `NET_*` fault code.
- **Requests that cannot be sent**: In an HTTP interceptor, when the platform refuses the request (an invalid or forbidden method, a GET or HEAD body, a URL with credentials, an invalid `Content-Type`) or a `finalizeHeaders` hook throws, `next(request)` rejects with the platform's own error (a `TypeError`) or the value the hook threw, not with the library's `BodyFailure` wrapper. Rethrowing it keeps the fault code (`REQ_BUILD_FAILED` or `EXT_HOOK_FAILED`); throwing a different error makes the failure yours (`EXT_INTERCEPTOR_FAILED`). The other failures found around the transport still reach `next(request)` as `BodyFailure`: a response body that cannot be read, decoded or matched to its media type, a truncated body, and a throwing upload progress observer (`EXT_OBSERVER_FAILED`), which can happen before the request is sent.
- **Throwing inside an interceptor**: An unhandled throw of the interceptor's own (or passing `next()` a `signal` that is not an `AbortSignal`) resolves the operation tuple with `EXT_INTERCEPTOR_FAILED` and sets `fault.cause`. Throwing `ERR_ABORTED` or `ERR_TIMEOUT` resolves `NET_ABORTED` or `NET_TIMEOUT`.

For SSE, prefer `withRetry` over an interceptor that calls `next()` repeatedly. Calling the interceptor's `next()` more than once disables endpoint attribution and re-picking for those replacement streams; it is unrelated to consuming events with an iterator's `next()`.

## 4. Wrap WebSocket sessions [#4-wrap-websocket-sessions]

A WebSocket interceptor may call `next(req)` **at most once**. When wrapping the returned `WebSocketSessionLike`, delegate live getters (`state`, `connection`, `bufferedAmount`), `close`, `closed`, `receive`, and `[Symbol.asyncDispose]()` rather than object-spreading a one-time snapshot:

```typescript
import { createWebSocketInterceptor } from "@defjs/core";

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request);

  return {
    get bufferedAmount() {
      return session.bufferedAmount;
    },
    get connection() {
      return session.connection;
    },
    get state() {
      return session.state;
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason);
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]();
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener);
    },
    onStateChange(listener) {
      return session.onStateChange(listener);
    },
    send(message: unknown) {
      session.send(message);
    },
  };
});
```

## 5. Built-in factories and helpers [#5-built-in-factories-and-helpers]

| Export                                         | Transport | Description                                                              |
| ---------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `createHttpInterceptor(fn)`                    | HTTP      | Wraps `(req, next) => Promise<HttpResponse<unknown>>`                    |
| `createSSEInterceptor(fn)`                     | SSE       | Wraps `(req, next) => Promise<EventStreamHandle<unknown>>`               |
| `createWebSocketInterceptor(fn)`               | WebSocket | Wraps `(req, next) => Promise<WebSocketSessionLike>`                     |
| `basicAuthHttpInterceptor(provider, options?)` | HTTP      | Injects `Authorization: Basic ...` from a sync/async credential provider |
| `basicAuthSSEInterceptor(provider, options?)`  | SSE       | Injects `Authorization: Basic ...` on SSE handshakes                     |

## Related reading [#related-reading]

- [Refresh a Bearer token once on 401](/recipes/refresh-bearer-once)
- [ETag conditional requests](/recipes/etag-revalidate)
- [OpenTelemetry Server](/docs/integrations/opentelemetry-server)
