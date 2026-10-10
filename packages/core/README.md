# @defjs/core

Type-safe HTTP, SSE, and WebSocket commands for TypeScript.

This README describes the package version that contains it. Defjs is still pre-1.0, so use the documentation and release notes published for the exact version installed in your application.

## Install

```sh
bun add @defjs/core
```

The package is ESM and declares no runtime dependencies. Its tarball retains this `README.md` and the repository `LICENSE`; repository-wide guides and examples remain outside the package.

## Quick Start

```typescript
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [error, user] = await client.execute(getUser({ id: 1 }))

if (error) {
  console.error(String(error), error.code)
} else {
  console.log(user.id, user.name)
}
```

`output` is one Struct for the 2xx body; `error` is one Struct for everything else. `ok` is the only fork, and only one side ever decodes. Omit a side and that body is never read.

## Core Boundaries

- Commands are typed values created by `defineRequest`, `defineEventStream`, and `defineWebSocket`.
- Structs validate request input and response data at runtime. A `builder` places parsed input onto `path`, `query`, `headers`, and `body`. Every definition with `input` requires an explicit `builder`; only definitions without `input` may omit it. `.alias(name)` is the wire name for a typed value.
- Expected failures are returned as native `Fault` instances in an error-first tuple; custom interceptors and application callbacks can still throw. A `Fault` is discriminated by one closed set of `code` values whose prefix is the class — `HTTP_STATUS`, `REQ_*`, `NET_*`, `RES_*`, `EXT_*`, `CAP_*`, `ENV_UNSUPPORTED`. `String(error)` is directly loggable, while `code` and the variant metadata remain enumerable for structured logs.
- Faults carry their underlying value on the native `Error` cause chain. Narrow `error.cause instanceof StructError` before calling Struct-only helpers such as `format()`, `flatten()`, or `prettify()`.
- Server clients that capture cookies, authorization, tenant data, or user data must be created inside the owning request scope.
- Ordinary HTTP work is request-scoped and is bounded with its execute-time timeout or `AbortSignal`; `Client` is not `AsyncDisposable` and has no global `dispose()` lifecycle.
- Returned SSE and WebSocket handles are `AsyncDisposable`, so `await using` waits for Defjs-owned teardown. SSE disposal stops Defjs reading/reconnect work and releases its reader lock, but does not wait forever for a provider-controlled `cancel()` promise.
- WebSocket `closed` is the logical terminal result. Its disposer uses a one-second bounded teardown and may reject with `TimeoutError`; it cannot prove physical TCP closure. Existing `close()` and `closed` APIs remain available for manual lifecycle control.
- A timeout or cancellation does not prove that a server did not receive a write. Preserve operation identity and use an application/server idempotency contract before replaying writes.
- OpenAPI generation, full SDK generation, query caching, and GraphQL protocol handling are not included in this release. Define contracts by hand or compose purpose-built tools at the application boundary.

For client-local tests, inject a Fetch-compatible function with `withHTTPHandle(...)`. This keeps request interception scoped to one client and still exercises command building, interceptors, status dispatch, and response validation.

### WebSocket messages

`incoming` and `outgoing` are each one struct. `session.send` encodes that struct (aliases included) and sends JSON. A frame that is not valid JSON, or does not match `incoming`, is reported to `session.onRuntimeError` and is not delivered. Use `struct.discriminatedUnion` when one socket carries several message kinds. Static subprotocols belong on `protocols`.

## Runtime Notes

Repository development, testing, building, packaging, and publishing use Bun `1.4.0`. The package uses standard Web APIs such as `fetch`, `Request`, `Response`, `Headers`, streams, and `WebSocket` according to the transports enabled by the application. The packed-consumer gate typechecks and executes the published artifact with Bun `1.4.0`.

The repository-validated and supported minimum compiler/lib contract uses `target: 'ES2022'` with `lib: ['ES2022', 'ESNext.Disposable', 'DOM', 'DOM.Iterable']`. The gate is pinned to TypeScript 7; older compiler versions are not promised. This supported set is verified together rather than claiming that every entry is independently forced by one declaration, and it supplies types only — not runtime Web API polyfills.

**SSE reconnect behavior change:** without `withSSEReconnect(...)`, SSE no longer retries network/stream-read failures. Pass `withSSEReconnect({ attempts: 3 })` (or another reviewed budget) to retry those failures.

When using a checkout through `file:` or a workspace link, run `bun run build` in the checkout before compiling or running the external consumer. The checkout manifest points to generated `dist/` files; published packages already contain those files.

After compiling an application to ESM, the repository-tested command is:

```sh
bun run dist/index.js
```

Browser applications use their bundler and the platform Fetch stream and WebSocket capabilities required by the transports they enable.

## Documentation

Guides live on the documentation site, not in the published tarball.

- [Getting started](https://defjs.org/guide/getting-started)
- [Client](https://defjs.org/core/client)
- [HTTP](https://defjs.org/core/http)
- [SSE](https://defjs.org/core/sse)
- [WebSocket](https://defjs.org/core/web-socket)
