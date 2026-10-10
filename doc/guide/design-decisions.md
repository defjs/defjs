---
title: Design decisions
description: Why Defjs keeps contracts, commands, transport results, decoding, and ownership explicit.
---

# Design decisions

Defjs makes a few deliberate trade-offs. Convenience APIs often hide who owns a request, stream, or session. Defjs keeps that boundary visible so you can reuse the same endpoint contract without silently picking up a cache, retry scheduler, or resource manager.

## Declaration is an assertion

These six rules decide every question about how a response is read. They are numbered so that a
later discussion can cite one instead of re-deriving it.

### 1. What you declare is what you assert

`output` means "when `ok` is true, the body _is_ this shape". `error` means "when `ok` is false,
the body _is_ this shape". A declaration is not a hint or a best-effort hope; it is a claim about
what will arrive.

### 2. `ok` is the only fork, and only one side ever decodes

A 2xx response is read with `output`. Anything else is read with `error`. Never both, never the
other one as a fallback.

### 3. Reality that differs from the assertion is a failure, reported loudly

No guessing at formats, no degrading to something weaker, no silence. Whether the backend
changed, a gateway intervened, or someone tampered with the response **does not change the
conclusion** — the library cannot tell those apart and should not pretend to.

This is the rule people most often want softened, so it is worth stating the case plainly.
Suppose an attacker can rewrite a `200` your page was about to read with `output`, and instead
you receive a `3xx`, `4xx`, or `5xx`. Failing is not an inconvenience; it is the only safe
outcome. Handing you the raw body "just in case" would give anyone who can inject a response a
way around the validation you asked for.

### 4. A failed decode has no body

A body _is_ a decoded value. If decoding failed, there is no value — there is no half-decoded
body to inspect. The offending detail lives on `cause`; the response keeps its metadata and
nothing more.

This one is enforced by the type system rather than by convention: a decode fault's `response` is
`HttpMeta`, which has no `body` field at all, so reaching for one is a compile error.

### 5. If you do not want the assertion, do not declare

Omitting `output` means "I do not care about the 2xx body" — it is never read. Omitting `error`
says the same for everything else. This is an explicit opt-out, not an oversight, and it goes all
the way: an unreadable body on the side you opted out of is none of your business, not even the
fact that it could not be read.

### 6. 3xx is not an error-code range

If you know an endpoint answers with a redirect status, do not hand `output` a schema for it, or
declare one that accepts an empty value. Reporting a failure otherwise is the expected outcome,
not a gap.

## Explicit clients

`createClient(...)` makes endpoint config an explicit value. Different environments or request scopes get different endpoints, credentials, interceptors, serializers, and transport handles.

The cost: no process-wide default. That cost helps on a server — create the client inside the request boundary when options or closures capture auth, cookies, users, tenants, or request metadata. An explicit client still doesn’t isolate state captured by an interceptor. Client identity isn’t a security boundary by itself.

A client dispatches commands. It doesn’t own active work. Whoever starts an HTTP request, SSE stream, or WebSocket session must cancel or close it and await the terminal promise.

## Definitions, endpoints, and commands

The definition is the stable contract: method, path, input struct, the structs that decode each side of `ok`, transport limits. `defineRequest` returns an endpoint. Calling it creates one opaque command for a single execution.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const command = getUser({ id: 7 })
```

A background job and a UI owner can execute the same `getUser` shape with different cancel/retry policies. Keeping the command opaque stops app code from depending on internal transport tags or symbols.

## Transport-specific results

All three transports use an error-first tuple. A single generic “response” would erase lifecycle facts.

- HTTP → `[err, data, response]` — decoded output + the response that produced it
- SSE → `[err, stream, open]` — one logical stream + startup response snapshot
- WebSocket → `[err, session, connection]` — logical session + startup connection snapshot

On success the third value is always present. An HTTP failure is `[error, undefined, undefined]`:
the fault already carries the response metadata, and that fault is what gets passed to a handler,
logged, or rethrown. SSE and WebSocket startup failures may still include the open or connection
snapshot when one was captured.

For SSE and WebSocket the third value is a snapshot, not a promise that future reconnects keep the
same physical connection. After startup, lifecycle control belongs to the returned handle or
session.

## Runtime decoding

TypeScript inference describes what you expect; it can’t check a server response at runtime. Struct parsing is the second half of the contract. Defjs validates command input before request construction, checks the representation, then parses the struct for whichever side of `ok` applies.

Decoding happens **once, after the interceptor chain**. A response that an interceptor built with
`makeResponse(...)` is interpreted exactly like one that came off the wire: where a response came
from does not change how it is read, so there is no "trust the interceptor" path to reason about.

The order is: media type, then representation, then struct.

| What did not hold                                               | Fault                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| The media type is not the one the declared representation needs | `RES_MEDIA_TYPE_INVALID` — reported _before_ the body is read |
| The bytes are not that representation                           | `RES_DECODE_FAILED`                                           |
| The value is not that struct                                    | `RES_STRUCT_MISMATCH`                                         |
| Non-2xx, and `error` decoded                                    | `HTTP_STATUS` with typed `data`                               |
| Non-2xx, and `error` was not declared                           | `HTTP_STATUS` with `data: undefined`                          |

Checking the media type first is what turns "I asked for JSON and received HTML" into one precise
fault instead of a parser error, and it skips the read, the parse, and the struct entirely.

## Builder, encoder, and alias

A struct is the field contract, in both directions. `.alias(name)` is the wire name. The struct decides how a value is encoded. The `builder` decides where that value goes.

`builder` is synchronous and pure. It receives the parsed input — the real value, not a binding view — and returns the request: `path`, `query`, `headers`, and `body`. It runs when the command executes. A throw becomes `REQ_BUILD_FAILED` on the tuple; calling the endpoint does not throw. A declared `input` always requires an explicit `builder`, even when it already matches the request shape. Only definitions without `input` may omit `builder`.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createBatch = defineRequest({
  method: 'POST',
  path: '/accounts/:account_id/users',
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    users: struct.array(
      struct.object({
        displayName: struct.string().alias('display_name'),
        email: struct.string(),
      }),
    ),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { 'x-api-version': '2' },
    body: { users: input.users },
  }),
  output: struct.object({ accepted: struct.number() }),
})

const command = createBatch({
  accountId: 42,
  users: [{ displayName: 'Ada', email: 'ada@example.com' }],
})
void command
```

The default path is to hand the typed value over. `body: { users: input.users }` keeps each user's alias, so the wire field is `display_name`. A key you write yourself (`account_id`, `x-api-version`) is literal. Spreading a typed object keeps its struct; adding the wire key beside the logical field is `REQ_BUILD_FAILED`.

Query nesting is a property of the backend, so it lives on the client: `withQuerySerializer((query) => string)` sees the encoded wire object, aliases included. It is not called when there is no query. A `URLSearchParams` returned by the builder skips it. Without a serializer, arrays repeat keys and a nested object fails. Interceptors observe `queryParams` as `new URLSearchParams(queryString)`.

Body kind is decided from the value, first match:

- no `body` → nothing is sent
- a `urlencoded` or `formData` codec on the body root → that form encoding; the tag does not apply when the value is nested inside JSON
- `FormData`, `URLSearchParams`, `Blob`, `File`, bytes, or a `ReadableStream` → sent as-is
- a string → `text/plain;charset=UTF-8`
- anything else → JSON

`undefined` fields are omitted. `null` on a nullable field is sent. A string is not JSON unless you stringify it and set `content-type`. Serializing yourself (`JSON.stringify`, qs, protobuf) leaves the struct encoder, so aliases do not apply. There is no public `struct.encode`.

`GET` and `HEAD` cannot carry a body. WebSocket builders cannot return headers or a body. Static WebSocket subprotocols stay on the definition (`protocols`), not in the builder. Invalid WebSocket frames go to the session runtime-error listener. An SSE `error` struct types the startup fault, and its handshake body follows the same kind rule as an HTTP body: `string` is text, blobs and files are blobs, `arrayBuffer` is bytes, and everything else is JSON.

## Observers and policy placement

Interceptors are for transport-wide policy: auth, tracing, short-circuit, reviewed retry. They run only for their transport and compose in onion order. Execution options are for work-specific lifetime: `signal`, `timeout`, WebSocket heartbeat, opt-in reconnect.

Observers report what happened without becoming a second owner. SSE `onInvalidEvent`, WebSocket state listeners, and runtime-error listeners are for bounded diagnostics and metrics. The returned stream/session still owns iteration, close, unsubscribe, and terminal waiting. Caching, stale-result suppression, idempotency, and domain error mapping belong around `client.execute(...)`, where your app can see its own policy and state.

## OpenAPI, sourcemaps, and telemetry

Defjs does not generate or sync a second OpenAPI contract. If OpenAPI is already authoritative, keep it and add runtime validation at the app boundary. For a new service, endpoint definitions and Structs can be the direct wire contract — no second source of truth.

`withOpenTelemetryServer(...)` adds **outbound** Defjs instrumentation to a client. It does not initialize an OpenTelemetry SDK. `tracer` is required, `meter` is optional, all three transports are enabled by default, and WebSocket query propagation is disabled by default. Keep operation names static and low-cardinality. Review propagation, hooks, URLs, headers, payloads, causes, and retention as potentially sensitive.

Sourcemaps are a deployment decision, not a Defjs behavior. A public map with `sourcesContent` exposes source; a hidden map still contains source and paths; disabling maps removes source-level symbolication. Treat private maps as deployable debugging artifacts with explicit access and retention rules.

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [Test with a local Fetch handle](../recipes/test-with-handle.md)
