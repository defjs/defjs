---
name: defjs
description: Write, review, test, and debug code that uses Defjs (@defjs/core, @defjs/react, @defjs/vue, @defjs/opentelemetry-server). Covers defining typed HTTP requests, SSE event streams, and WebSockets with defineRequest, defineEventStream, defineWebSocket, and struct; creating clients with createClient and withEndpoint; multiple endpoints, load balancing, withRetry, reconnect, auth refresh, and cancellation; error-first tuple handling and Fault narrowing; React, Vue, and OpenTelemetry integrations; and publishing standalone Defjs SDKs. Use when a project imports @defjs/*, or the user mentions Defjs, defineRequest, defineEventStream, defineWebSocket, struct, or an SDK built on Defjs.
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
6. **Choose the policy boundary.** Use `withRetry` for same-call HTTP failover; use transport reconnect options for SSE/WebSocket. Keep auth, token refresh, `Retry-After`, and tracing in interceptors.
7. **Verify** with the project's typecheck and deterministic transport-handle tests.

## The six rules

1. **`input` declares, `builder` places.** A definition with `input` must provide an explicit synchronous pure `builder` returning `{ path?, query?, headers?, body? }`. Placement is never inferred from field names or path placeholders.
2. **Calling an operation runs it.** `getOrder(client, input)` or `getOrder(client(options), input)`. `client(options)` returns a non-callable `Client` value for one call and performs no I/O. There is no global client.
3. **Results are error-first tuples.** Check `if (error)` and return before using the success value. Request, response, and transport failures do not throw at the call site.
4. **`struct` only declares structure.** Struct instances have no `.parse()`; call `struct.parse(schema, value)`. There is no `struct.encode`, no validation DSL, and no zero-filling.
5. **Auth, tracing, and application replay policies belong in an interceptor**, never in `builder`. Use `withRetry` for endpoint failover. Put low-cardinality identity in `operation`.
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

## Reference routing table

Load only the reference file needed for your current task. Each link is one level deep and self-contained.

| Task or topic                                                                                                                         | Reference file                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Schemas, `.optional()`/`.nullable()`/`.nullish()`/`.alias()`, `struct.parse`, form/binary tags, recursive structs                     | [references/struct.md](references/struct.md)                                         |
| `defineRequest`, `builder` placement (`path`/`query`/`headers`/`body`), query serializer, body Content-Type rules, cancellation       | [references/http.md](references/http.md)                                             |
| `createClient`, `DerivableClient` vs `Client` value, `RequestOptions`, `with*` helpers, SSR vs browser scoping                        | [references/client.md](references/client.md)                                         |
| Multiple endpoints, `withBalancer`, strategies, health filtering, `withRetry` defaults/budget, reconnect boundaries, custom lifecycle | [references/load-balancing.md](references/load-balancing.md)                         |
| Error-first tuple shapes, `Fault` codes and variants, narrowing declared `HTTP_STATUS` `error.data`, fault triage                     | [references/errors.md](references/errors.md)                                         |
| `createHttpInterceptor`, SSE/WebSocket interceptors, Bearer auth & 401 refresh, safe retries with `Retry-After`, ETag                 | [references/interceptors.md](references/interceptors.md)                             |
| `defineEventStream`, SSE `events` map, buffer/queue limits, startup deadline, `withSSEReconnect`, `withSSEOnInvalidEvent`             | [references/sse.md](references/sse.md)                                               |
| `defineWebSocket`, `incoming`/`outgoing` `discriminatedUnion`, `session.send`, `onRuntimeError`, heartbeat, reconnect, `protocols`    | [references/web-socket.md](references/web-socket.md)                                 |
| `@defjs/react`: `ClientProvider`, `useClient`, `useEffect` abort cleanup, owning streams/sockets in components                        | [references/react.md](references/react.md)                                           |
| `@defjs/vue`: `createClientPlugin`, `injectClient`, custom `InjectionKey`, `watch` `onCleanup`, `onScopeDispose`                      | [references/vue.md](references/vue.md)                                               |
| `@defjs/opentelemetry-server`: `withOpenTelemetryServer`, low-cardinality `operation`, WebSocket query propagation                    | [references/opentelemetry-server.md](references/opentelemetry-server.md)             |
| Offline testing with `withHTTPHandle`, publishing a standalone SDK package, unsupported patterns, code review checklist               | [references/testing-and-sdk-publishing.md](references/testing-and-sdk-publishing.md) |

## Verify

Run the project's typecheck and the tests that cover the code you changed. If you cannot run them, say so. A call that type-checks but never reads `error` first is still wrong.
