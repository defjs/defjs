# @defjs/core

Design reusable HTTP, SSE, and WebSocket APIs as data, then execute them with an application-owned client.

`def` means `define`. An SDK author exports operation definitions and data contracts. The consuming application supplies the endpoint, credentials, interceptors, and transport. Importing a definition starts no request and binds no client.

## Install

```sh
bun add @defjs/core
```

The package is ESM and declares no runtime dependencies. Declarations target `ESNext`, whose lib set includes `ESNext.Disposable`, plus `DOM` and `DOM.Iterable`; those entries supply types only, not polyfills. Because Defjs is pre-1.0, consult the documentation for the version you installed.

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
- Per-call options (`signal`, `onUploadProgress`, `onDownloadProgress`, `beforeConnect`, `protocols`, `heartbeat`, `retry`) go through `client(options)`, which returns a client value for one call and performs no I/O. Pass `AbortSignal.timeout(ms)` as `signal` when a call needs a deadline. See [Client](https://defjs.lyz.cloud/docs/client).
- `input` declares parameters; a synchronous, pure `builder` places them on `path`, `query`, `headers`, and `body`. Every definition with `input` requires an explicit `builder`.
- Structs validate at runtime. `output` is the 2xx body, `error` every other status; omit a side and that body is never read.
- Failures are returned as `Fault` instances in an error-first tuple — `HTTP_STATUS`, `REQ_*`, `NET_*`, `RES_*`, `EXT_*`, `CAP_*`, `ENV_UNSUPPORTED`. `String(error)` gives `DefjsFault: <message>`, because every fault is named `DefjsFault`; `error.code` and the cause chain stay structured for logs.
- Retries are off by default. `withRetry` turns them on with one policy for HTTP, SSE, and WebSocket; a streaming request body never retries. Defaults, endpoint selection, and health filtering are described in [Load balancing](https://defjs.lyz.cloud/docs/load-balancing).
- A timeout or cancellation does not prove the server missed a write. Keep an application idempotency contract before replaying writes.
- The caller owns every returned SSE stream and WebSocket session. Both are `AsyncDisposable`: use `await using`, or call `close()` and await `closed`.
- Inject a Fetch-compatible function with `withHTTPHandle(...)` to test a client without a server — see [Test with a handle](https://defjs.lyz.cloud/recipes/test-with-handle).

## Documentation

- [Getting started](https://defjs.lyz.cloud/docs/start)
- [Client](https://defjs.lyz.cloud/docs/client) · [Errors](https://defjs.lyz.cloud/docs/errors) · [Struct](https://defjs.lyz.cloud/docs/struct)
- [HTTP](https://defjs.lyz.cloud/docs/http) · [SSE](https://defjs.lyz.cloud/docs/sse) · [WebSocket](https://defjs.lyz.cloud/docs/web-socket)

## License

MIT.
