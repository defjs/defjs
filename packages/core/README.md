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
- Expected failures are returned as native `Fault` instances in an error-first tuple; custom interceptors and application callbacks can still throw. A `Fault` is discriminated by one closed set of `code` values whose prefix is the class — `HTTP_STATUS`, `REQ_*`, `NET_*`, `RES_*`, `EXT_*`, `CAP_*`, `ENV_UNSUPPORTED`. `String(error)` renders the fault message; review record keys in structural paths and custom messages before logging. `code` and the variant metadata remain enumerable for structured logs.
- Default Struct messages name the received kind, never its value, for example `Expected number at email, received string`. `RES_DECODE_FAILED` from a JSON `SyntaxError` says `Response body could not be decoded`. Raw `StructIssue.received` and parser causes remain sensitive; custom `errorMap` and extension messages are used verbatim and need review before logging. Any string from `errorMap`, including `''`, replaces the default, also for bigint/date conversion failures from another Core copy.
- Faults carry their underlying value on the native `Error` cause chain. Narrow `error.cause instanceof StructError` before calling Struct-only helpers such as `format()`, `flatten()`, or `prettify()`.
- `isAbortCause(cause)` and `isTimeoutCause(cause)` recognize cancellation sentinels across Core copies through their non-enumerable `Symbol.for` brands. The former also recognizes a `DOMException` named `AbortError`; the latter recognizes a `DOMException` or `Error` named `TimeoutError`. Pass a fault's underlying `cause`, not the fault itself.
- Server clients that capture cookies, authorization, tenant data, or user data must be created inside the owning request scope.
- Ordinary HTTP work is request-scoped and is bounded with its execute-time timeout or `AbortSignal`; `Client` is not `AsyncDisposable` and has no global `dispose()` lifecycle.
- Returned SSE and WebSocket handles are `AsyncDisposable`, so `await using` waits for Defjs-owned teardown. SSE disposal stops Defjs reading/reconnect work and releases its reader lock, but does not wait forever for a provider-controlled `cancel()` promise.
- WebSocket `closed` is the logical terminal result. Its disposer uses a one-second bounded teardown and may reject with `TimeoutError`; it cannot prove physical TCP closure. Existing `close()` and `closed` APIs remain available for manual lifecycle control.
- A timeout or cancellation does not prove that a server did not receive a write. Preserve operation identity and use an application/server idempotency contract before replaying writes.
- OpenAPI generation, full SDK generation, query caching, and GraphQL protocol handling are not included in this release. Define contracts by hand or compose purpose-built tools at the application boundary.

For client-local tests, inject a Fetch-compatible function with `withHTTPHandle(...)`. This keeps request interception scoped to one client and still exercises command building, interceptors, status dispatch, and response validation.

### WebSocket messages

`incoming` and `outgoing` are each one struct. `session.send` encodes that struct (aliases included) and sends JSON. A frame that is not valid JSON, or does not match `incoming`, is reported to `session.onRuntimeError` and is not delivered. Use `struct.discriminatedUnion` when one socket carries several message kinds. Static subprotocols belong on `protocols`.

After encoding, values JSON cannot faithfully represent throw `TypeError` before sending or entering the reconnect queue, including non-finite numbers, functions, symbols, `Map`, `Set`, streams, and class instances without a JSON representation. The same serializer protects heartbeat messages; a heartbeat serialization failure ends the session. If setting an injected handle's `binaryType` throws, Core requests best-effort closure before failing the attempt.

## Runtime Notes

Repository development, testing, and building use Bun `1.4.3`; package release jobs use `npm publish`. The package uses standard Web APIs such as `fetch`, `Request`, `Response`, `Headers`, streams, and `WebSocket` according to the transports enabled by the application. Repository type checking uses `bun check`; declaration files are generated by tsdown.

The default HTTP and SSE handles resolve the current global `fetch` on each call, including replacements installed after import. Importing Core without Fetch is valid; default execution reports `ENV_UNSUPPORTED` if it is still missing, while custom handles remain usable. HTTP uses `(url, init)` only for untouched platform Fetch; replaced globals and custom handles receive a `Request`.

Server-side FormData upload progress reads the serialized stream directly without whole-body Blob buffering and preserves its multipart boundary. The total is unknown unless a valid explicit `Content-Length` supplies it. Explicit content types survive body replacement and upload conversion, with FormData's actual boundary as the exception. Downloads with non-identity encoding report `lengthComputable: false` and `total: 0`; `loaded` counts stream bytes, which Fetch may already have decompressed. In a Window or Worker, XSRF injection checks the resolved origin against `location.origin`; cookie lookup separately requires `document`.

The supported minimum compiler/lib contract uses `target: 'ES2022'` with `lib: ['ES2022', 'ESNext.Disposable', 'DOM', 'DOM.Iterable']`. TypeScript 7 is the current repository tooling baseline; older compiler versions are not promised. The repository currently uses `ESNext` and does not automatically verify this minimum consumer lib set. These entries supply types only — not runtime Web API polyfills.

CI runs the Bun `verify` gate, Core's `core-server` and OpenTelemetry tests on Node 24, and a Deno 2 smoke test of the built Core bundle's HTTP, SSE, WebSocket, and Struct APIs. Package release jobs typecheck their build configurations and assert required files with `npm pack --dry-run`; they do not install tarballs into an external consumer for declaration or runtime verification.

**SSE reconnect behavior change:** without `withSSEReconnect(...)`, SSE no longer retries network/stream-read failures. Pass `withSSEReconnect({ attempts: 3 })` (or another reviewed budget per outage) to retry those failures. SSE and WebSocket both reset the retry budget and backoff exponent after a successful handshake. `maxDelayMs` caps the final delay after jitter and rounding, also bounded by `2_147_483_647` ms; zero bases stay zero and valid-number overflow saturates. Invalid numeric reconnect options fail before transport with `REQ_OPTIONS_INVALID`; WebSocket `attempts: 0` disables retry immediately and ignores the unused fields, while SSE still validates them. SSE sends `Last-Event-ID` as UTF-8 bytes and strips only the physical stream's leading BOM, preserving U+FEFF in field values.

When using a checkout through `file:` or a workspace link, run `bun run build` in the checkout before compiling or running the external consumer. The checkout manifest points to generated `dist/` files; published packages already contain those files.

For an application compiled to ESM with an entry at `dist/index.js`, one possible Bun launch command is:

```sh
bun run dist/index.js
```

This is an application launch example, not a repository-tested consumer check.

Browser applications use their bundler and the platform Fetch stream and WebSocket capabilities required by the transports they enable.

## Documentation

Guides live on the documentation site, not in the published tarball.

- [Getting started](https://defjs.lyz.cloud/docs/start)
- [Client](https://defjs.lyz.cloud/docs/client)
- [HTTP](https://defjs.lyz.cloud/docs/http)
- [SSE](https://defjs.lyz.cloud/docs/sse)
- [WebSocket](https://defjs.lyz.cloud/docs/web-socket)
