# @defjs/core

Design reusable HTTP, SSE, and WebSocket APIs as data, then execute them with an application-owned client.

`def` means `define`. An SDK author exports operation definitions and data contracts. The consuming application supplies the endpoint, credentials, interceptors, and transport. Importing a definition starts no request and binds no client.

## Install

```sh
bun add @defjs/core
```

The package is ESM and declares no runtime dependencies. Declarations target `ES2022` with `ESNext.Disposable`, `DOM`, and `DOM.Iterable`; those entries supply types only, not polyfills. Defjs is pre-1.0, so use the documentation for the exact version you installed.

## Quick start

```ts
// orders-sdk.ts — SDK definition
import { defineRequest, struct } from "@defjs/core";

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: struct.object({ message: struct.string() }),
});
```

```ts
// app.ts — application-owned client
import { createClient, withEndpoint } from "@defjs/core";
import { getOrder } from "./orders-sdk.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, order] = await getOrder(client, { id: 1 });
  if (error) {
    console.error(String(error), error.code);
    return;
  }
  console.log(order.status);
}

void main();
```

Calling `getOrder(client, { id: 1 })` validates, builds, and sends the request. `client({ signal })` returns a `Client` value for one call and does not perform I/O. Return before reading the success value when `error` is set. Once published, import `getOrder` from your SDK package instead of the local file — see [Build and publish an SDK](https://defjs.lyz.cloud/recipes/publish-http-sdk).

## Rules that matter

- Calling an operation with a client performs I/O. A definition does not capture a client. There is no global client.
- Per-call options are the seven `RequestOptions` fields: `signal`, `onUploadProgress`, `onDownloadProgress`, `beforeConnect`, `protocols`, `heartbeat`, and `reconnect`. `client()` and `client(undefined)` store no request options. `client({})` keeps an empty snapshot. `client(options)` reads each top-level field once. A `protocols` array is copied. `heartbeat` copies `intervalMs`, `isAck`, `message`, and `timeoutMs`. `reconnect` copies `attempts`, `connectTimeoutMs`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, and `shouldReconnect`. Missing nested blocks stay missing. `signal` and callbacks keep their identity. Pass `AbortSignal.timeout(ms)` as `signal` when a call needs a deadline. That reason is `NET_TIMEOUT`; a manual abort is `NET_ABORTED`. A getter on a captured field throws from `client(options)` or from applying the matching `with*` helper, not as a fault. Invalid numbers still return `REQ_OPTIONS_INVALID` when the operation runs. The base configuration stays shared and is not frozen. SSE and WebSocket can set `connectTimeoutMs` in their reconnect policy to bound only each handshake; the caller signal still covers the whole connection.
- `input` declares parameters; a synchronous, pure `builder` places them on `path`, `query`, `headers`, and `body`. Every definition with `input` requires an explicit `builder`.
- Structs validate at runtime. `output` is the 2xx body, `error` every other status; omit a side and that body is never read.
- Failures are returned as `Fault` instances in an error-first tuple — `HTTP_STATUS`, `REQ_*`, `NET_*`, `RES_*`, `EXT_*`, `CAP_*`, `ENV_UNSUPPORTED`. `String(error)` gives the message; `error.code` and the cause chain stay structured for logs.
- Multiple endpoints default to sticky selection across calls. Same-call HTTP retry is off by default: omit `withRetry` for one attempt and no retry budget. Use `withRetry({})` to enable one untried backup on connection failure for safe HTTP methods, with 25ms base delay, factor 2, ±20% jitter, and a 250ms cap. `maxAttempts` counts all attempts including the first (default 2, safe integer at least 1); `1` disables replay. Streaming request bodies never fail over. `pickFirstBalancer` advances on `NET_UNREACHABLE` or `NET_UNAVAILABLE` (HTTP 502, 503, or 504), and optional `failbackMs` probes the first endpoint after the interval.
- `roundRobinBalancer` and `p2cBalancer` enable health filtering by default (Finagle); `outlierDetection: false` disables it. Five attributed consecutive failures break a replica; the default classifier counts `NET_UNREACHABLE`, `NET_UNAVAILABLE`, and `NET_SERVER_ERROR`. Linkerd-style penalties start at 1s, double after failed single probes, add positive jitter (0.5 by default), and cap at 60s; successful probes reset them. Timeouts and incomplete bodies do not fail by default. All hosts may break, with Finagle-style fail-open; there is no Envoy/gRPC A50 quota, last-host protection, percentage criterion, or slow start. Active checks read an application-owned cache synchronously. p2c samples distinct candidates using tower PeakEwma (Linkerd defaults: RTT 30ms, decay 10s) or pending load. `start` begins load; `end` when the peer response begins releases it and samples real RTT, without a failure penalty. `done` retains final health classification and releases load if no `end` arrived. Opt-in same-call HTTP retry shares a Finagle/Linkerd retry budget per client configuration, including derived clients (20%, 10 retries/s reserve, 10s TTL); `withRetry({ budget: false })` disables that limit. Separate clients keep independent budgets even when they share a balancer. No background health or budget timer runs.
- Attributed transport failures after successful SSE headers report final `NET_UNREACHABLE` at the response-body read boundary; an opened WebSocket's code 1006 or strictly false `wasClean` does too, even without a native error event. `end` remains the headers/open snapshot. Cancellation and timeout keep priority. Normal EOF, clean close, and application errors do not themselves create network failures; HTTP incomplete bodies remain `NET_BODY_INCOMPLETE`. Health feedback does not enable reconnection or authorize replay: stream reconnect remains opt-in.
- A timeout or cancellation does not prove the server missed a write. Keep an application idempotency contract before replaying writes.
- Returned SSE and WebSocket handles are `AsyncDisposable`; WebSocket `closed` is the logical terminal result.
- Inject a Fetch-compatible function with `withHTTPHandle(...)` to test a client without a server — see [Test with a handle](https://defjs.lyz.cloud/recipes/test-with-handle).

## Documentation

- [Getting started](https://defjs.lyz.cloud/docs/start)
- [Client](https://defjs.lyz.cloud/docs/client) · [Errors](https://defjs.lyz.cloud/docs/errors) · [Struct](https://defjs.lyz.cloud/docs/struct)
- [HTTP](https://defjs.lyz.cloud/docs/http) · [SSE](https://defjs.lyz.cloud/docs/sse) · [WebSocket](https://defjs.lyz.cloud/docs/web-socket)

## License

MIT.
