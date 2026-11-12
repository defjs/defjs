---
name: defjs
description: Write, review, test, and debug code that uses Defjs (@defjs/core, @defjs/react, @defjs/vue, @defjs/opentelemetry-server). Covers defining typed HTTP requests, SSE event streams, and WebSockets with defineRequest, defineEventStream, defineWebSocket, and struct; creating clients with createClient and withEndpoint; multiple endpoints, load balancing, withRetry for HTTP, SSE, and WebSocket retries, auth refresh, and cancellation; error-first tuple handling and Fault narrowing; React, Vue, and OpenTelemetry integrations; and publishing standalone Defjs SDKs. Use when a project imports @defjs/*, or the user mentions Defjs, defineRequest, defineEventStream, defineWebSocket, struct, or an SDK built on Defjs.
license: MIT
compatibility: Needs a TypeScript or JavaScript project with ESM and the @defjs packages installed.
metadata:
  author: defjs
  version: "1.0.0"
---

# Defjs

Defjs separates the two sides of an SDK:

- **Definition**: the SDK author declares operations with `defineRequest`, `defineEventStream`, and `defineWebSocket`. A definition is data: importing it performs no I/O and binds no client.
- **Execution**: the application creates its own client (`createClient(withEndpoint(...))`) and calls the operation: `getOrder(client, input)` or `getOrder(client(options), input)`. Calling it performs I/O.

## Before you write code

Read the project's conventions, test runner, and formatter, and follow them. Check the installed `@defjs/*` types when you need an exact signature. Change dependencies only when the user asks.

## When not to use

Skip this skill for plain `fetch` or axios code, for other SDKs or query libraries (TanStack Query, SWR), and for questions that do not involve `@defjs/*`.

## Workflow

1. **Locate the side you are on.** Writing a reusable definition (SDK module) or calling one (application module)? Keep the two in separate files.
2. **Load only the reference file(s) matching your task** from the routing table below.
3. **Write the definition.** Declare `input`, `output`, and `error` with `struct`, and add the explicit synchronous `builder`. _Check:_ every definition with `input` has a `builder`, and `builder` does no I/O or auth.
4. **Write the call site.** Pass the application's `client` (or `client({ signal })` per call) and read `error` first. _Check:_ nothing reads the success value before the `if (error)` branch returns.
5. **Own the lifecycle** for SSE streams and WebSocket sessions. _Check:_ each is bound with `await using` or closed and awaited in `finally`.
6. **Choose the policy boundary.** Use `withRetry` for retries on every transport (HTTP, SSE, and WebSocket share one policy and `shouldRetry`). Keep auth, token refresh, `Retry-After`, and tracing in interceptors.
7. **Verify** with the project's typecheck and deterministic transport-handle tests.

## The six rules

1. **`input` declares, `builder` places.** A definition with `input` must provide an explicit synchronous pure `builder` returning `{ path?, query?, headers?, body? }`. Placement is never inferred from field names or path placeholders.
2. **Calling an operation runs it.** `getOrder(client, input)` or `getOrder(client(options), input)`. `client(options)` returns a non-callable `Client` value for one call and performs no I/O. There is no global client.
3. **Results are error-first tuples.** Check `if (error)` and return before using the success value. Request, response, and transport failures do not throw at the call site.
4. **`struct` only declares structure.** Struct instances have no `.parse()`; call `struct.parse(schema, value)`. There is no `struct.encode`, no validation DSL, and no zero-filling.
5. **Auth, tracing, and application replay policies belong in an interceptor**, never in `builder`. Use `withRetry` for retry and reconnect. Put low-cardinality identity in `operation`.
6. **The caller owns streams and sessions.** After a successful SSE or WebSocket startup, handle runtime errors, close the handle/session, and await `closed` (or use `await using`).

## Minimal correct example

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  operation: "orders.get",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, order] = await getOrder(client, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
```

## Review checklist

When reviewing Defjs code, check each item:

- [ ] Definition modules (`defineRequest`, `defineEventStream`, `defineWebSocket`) do not import or create a client.
- [ ] Every definition with `input` has an explicit, synchronous, pure `builder`.
- [ ] `builder` performs no I/O, reads no auth tokens, and passes typed struct objects (`body: input.order`) so `.alias(...)` applies.
- [ ] Every call site checks `if (error)` and returns before reading the success value.
- [ ] Call sites are not wrapped in `try/catch` expecting HTTP or network errors to throw; they resolve on the tuple.
- [ ] Derived clients carrying a `signal` (`client({ signal })`) are created per call, not shared across unrelated calls.
- [ ] Authentication, token refresh, and tracing live in interceptors (`withInterceptors`), not in `builder`.
- [ ] Retries are enabled with `withRetry`; by default it replays `GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT`, and `DELETE`, never a `ReadableStream` body, and stops when the caller's `signal` aborts.
- [ ] Every opened SSE stream and WebSocket session is closed with `await using` or `finally { close(); await closed; }`.
- [ ] React `useEffect` and Vue `watch` / `onScopeDispose` abort in-flight operations on cleanup and ignore late completions after abort.

## Reference routing table

The files in `references/` are generated copies of the Defjs documentation pages; do not edit them. Load only the file needed for your current task. Each link is one level deep. A link inside a reference that starts with `/docs/` or `/recipes/` names another reference by the last segment of its path (`/recipes/refresh-bearer-once` is `references/refresh-bearer-once.md`). `/api/...` pages are not shipped; the installed `@defjs/*` types hold the exact signatures and are the authority for your version.

| Task or topic                                                                                                | Reference file                                                           |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Schemas, `.optional()`/`.nullable()`/`.nullish()`/`.alias()`, `struct.parse`, form/binary tags, recursion    | [references/struct.md](references/struct.md)                             |
| `defineRequest`, `builder` placement, query serializer, body Content-Type rules, cancellation, progress      | [references/http.md](references/http.md)                                 |
| `createClient`, `DerivableClient` vs `Client` value, `RequestOptions`, `with*` helpers, SSR vs browser scope | [references/client.md](references/client.md)                             |
| Multiple endpoints, `withBalancer`, strategies, health filtering, `withRetry` defaults and budget            | [references/load-balancing.md](references/load-balancing.md)             |
| Error-first tuple shapes, `Fault` codes, narrowing declared `HTTP_STATUS` `error.data`, structured logging   | [references/errors.md](references/errors.md)                             |
| `createHttpInterceptor`, short-circuiting, `Retry-After`, WebSocket session wrapping                         | [references/interceptors.md](references/interceptors.md)                 |
| Bearer auth with a single-flight refresh and one replay after 401                                            | [references/refresh-bearer-once.md](references/refresh-bearer-once.md)   |
| `304 Not Modified` as an `HTTP_STATUS` fault, ETag revalidation with an application cache                    | [references/etag-revalidate.md](references/etag-revalidate.md)           |
| One GET that branches on a typed 200 and a declared 404                                                      | [references/get-declared-404.md](references/get-declared-404.md)         |
| Sending a typed JSON body and decoding a declared 201                                                        | [references/post-json.md](references/post-json.md)                       |
| Abort or time out an HTTP call and read the abort and timeout faults                                         | [references/cancel-http.md](references/cancel-http.md)                   |
| Open a typed SSE stream, iterate, then close and await `closed`                                              | [references/consume-sse.md](references/consume-sse.md)                   |
| WebSocket session: send one envelope, receive once, close and await `closed`                                 | [references/websocket-session.md](references/websocket-session.md)       |
| `defineEventStream`, SSE `events` map, buffer limit, startup deadline, retries, `withSSEOnInvalidEvent`      | [references/sse.md](references/sse.md)                                   |
| `defineWebSocket`, `incoming`/`outgoing` `discriminatedUnion`, `session.send`, heartbeat, retries, protocols | [references/web-socket.md](references/web-socket.md)                     |
| `@defjs/react`: `ClientProvider`, `useClient`, `useEffect` abort cleanup, owning streams and sockets         | [references/react.md](references/react.md)                               |
| `@defjs/vue`: `createClientPlugin`, `injectClient`, custom `InjectionKey`, `watch` cleanup                   | [references/vue.md](references/vue.md)                                   |
| `@defjs/opentelemetry-server`: `withOpenTelemetryServer`, low-cardinality `operation`, propagation, logs     | [references/opentelemetry-server.md](references/opentelemetry-server.md) |
| Offline tests with `withHTTPHandle`, `withSSEHandle`, `withWebSocketHandle`, fake timers                     | [references/testing.md](references/testing.md)                           |
| A complete local test that swaps Fetch for `withHTTPHandle`                                                  | [references/test-with-handle.md](references/test-with-handle.md)         |
| Publishing a standalone SDK package                                                                          | [references/publish-http-sdk.md](references/publish-http-sdk.md)         |
| Definition vs execution, declaration is an assertion, what Defjs does not provide                            | [references/design-decisions.md](references/design-decisions.md)         |

## Verify

Run the project's typecheck and the tests that cover the code you changed. If you cannot run them, say so. A call that type-checks but never reads `error` first is still wrong.
