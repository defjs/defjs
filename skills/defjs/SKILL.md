---
name: defjs
description: Use when a project imports @defjs/* (@defjs/core, @defjs/react, @defjs/vue, @defjs/opentelemetry-server), or when writing, reviewing, testing, or debugging code that uses Defjs, defineRequest, defineEventStream, defineWebSocket, struct, createClient, withEndpoint, withRetry, or an SDK built on Defjs.
license: MIT
compatibility: Needs a TypeScript or JavaScript project with ESM and the @defjs packages installed.
metadata:
  author: defjs
  version: "1.0.0"
---

# Defjs

Defjs separates the two sides of an SDK so operation contracts can be shared or published without coupling to endpoints, credentials, or transport state:

- **Definition (`defineRequest`, `defineEventStream`, `defineWebSocket`, `struct`)**: Pure declarative data exported by SDK modules. Importing or defining an operation performs no I/O and captures no client.
- **Execution (`createClient`, `withEndpoint`, `operation(client, input)`)**: The consuming application owns the client and calls the operation (`getOrder(client, input)` or `getOrder(client(options), input)`). Calling the operation performs I/O and resolves to an error-first tuple `[error, data, response]`.

## Workflow

1. **Separate definition from execution.** Put `struct` schemas and `defineRequest` / `defineEventStream` / `defineWebSocket` exports in SDK modules; put `createClient(...)` and operation calls in application modules.
2. **Load only the task reference file you need** from the [Task routing table](#task-routing-table) below.
3. **Declare schemas and explicit placement.** Define `input`, `output`, and `error` with `struct`. Whenever `input` is declared, provide a synchronous pure `builder: (input) => ({ path?, query?, headers?, body? })`.
4. **Call the operation and guard the error slot first.** Pass `client` (or `client({ signal })` per call), check `if (error)` and return before reading the success value.
5. **Own realtime lifecycles.** Bind every opened SSE stream or WebSocket session with `await using` or close it and `await closed` in `finally`.
6. **Put cross-cutting policies in client options and interceptors.** Use `withRetry` for retries and reconnects, `withInterceptors` for auth/refresh/`Retry-After`/logging, and a static low-cardinality `operation` string on every definition.
7. **Verify** with the project's typecheck and deterministic `withHTTPHandle` / `withSSEHandle` / `withWebSocketHandle` tests.

## The six rules

1. **`input` declares, `builder` places.** Any definition with `input` requires a synchronous pure `builder`. Defjs never infers placement from field names or `:param` placeholders.
2. **Calling an operation runs it.** Call `getOrder(client, input)` or `getOrder(client(options), input)`. Calling `client(options)` performs no I/O and returns a single-call, non-callable `Client` value (`client()()` is a compile error). There is no global client.
3. **Results are error-first tuples.** Operations resolve to `[error, data, response]` (HTTP), `[error, stream, startupOpen]` (SSE), or `[error, session, startupConnection]` (WebSocket). Request, validation, HTTP status, decode, and network failures never throw at the call site.
4. **`struct` only declares structure.** Struct instances have no `.parse()` method; call `struct.parse(schema, value, options?)`. There is no `struct.encode`, no regex/length validation DSL, and no zero-filling.
5. **Auth, token refresh, `Retry-After`, and tracing belong in interceptors**, never in `builder`. Use `withRetry` for HTTP, SSE, and WebSocket retries. Set a static low-cardinality `operation` name (such as `"orders.get"`).
6. **The caller owns streams and sessions.** After a successful SSE or WebSocket startup, handle runtime errors, close the handle/session, and `await closed` (or use `await using`).

## Common habits vs Defjs best practices

Agents trained on Axios, Fetch, or Zod often apply habits that break Defjs contracts. Follow the right column:

| Habit from other libraries (Wrong)                                    | Defjs best practice (Right)                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Creating `createClient(...)` inside the SDK definition file           | Export only `struct` and `define*` from SDK files; create `client` in the consuming app                 |
| Omitting `builder` expecting `:id` to be inferred from `input`        | Always write `builder: (input) => ({ path: { id: input.id } })` whenever `input` is present             |
| Making `builder: async (input) => ...` or reading auth tokens         | Keep `builder` synchronous and pure; read tokens inside `createHttpInterceptor`                         |
| Mapping `.alias("wire_key")` by hand in `builder` literals            | Pass the typed struct value (`body: input.order`) so Defjs encodes wire aliases automatically           |
| Wrapping `await getOrder(client, input)` in `try / catch`             | Destructure `const [error, data] = await getOrder(client, input); if (error) return;`                   |
| Calling `OrderSchema.parse(raw)`                                      | Call `const [error, data] = struct.parse(OrderSchema, raw);`                                            |
| Reusing `const timed = client({ signal: AbortSignal.timeout(5000) })` | Derive `client({ signal: AbortSignal.timeout(5000) })` inline at each call site                         |
| Passing `useClient()` to `useState(client)` or `watch(client)`        | `DerivableClient` is a function; call `useClient()` / `injectClient()` directly and never wrap in state |

## End-to-end best practice example

Keep definitions in an SDK module and execution in the application module:

```ts
// sdk/orders.ts — pure definitions and schemas; no client, no I/O
import { defineRequest, struct, type Infer } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.enum(["pending", "paid", "shipped"]),
  customerName: struct.string().alias("customer_name"),
});
export type Order = Infer<typeof Order>;

export const OrderError = struct.object({
  code: struct.string(),
  message: struct.string(),
});

export const getOrder = defineRequest({
  method: "GET",
  operation: "orders.get",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: Order,
  error: OrderError,
});
```

```ts
// app/main.ts — application owns endpoint, options, and error-first execution
import { createClient, withEndpoint, withRetry } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(
  withEndpoint("https://api.example.com/v1"),
  withRetry({ maxRetries: 2 }),
);

async function main() {
  const [error, order, response] = await getOrder(
    client({ signal: AbortSignal.timeout(5_000) }),
    { id: 42 },
  );
  if (error) {
    if (error.code === "HTTP_STATUS") {
      console.error(error.status, error.data.code, error.data.message);
      return;
    }
    console.error(error.code, error.message);
    return;
  }
  console.log(order.customerName, order.status, response.status);
}

void main();
```

## Task routing table

Load only the reference file that matches your current task:

| Task domain                                                                                                                                                         | Reference file                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Schemas (`struct.*`, `.alias()`, `struct.parse`, recursive structs), `defineRequest`, `builder` placement, query/body codecs, cancellation, `Fault`                 | [references/http-and-struct.md](references/http-and-struct.md)                     |
| `createClient`, `RequestOptions`, XSRF, multi-endpoint load balancing (`withBalancer`), `withRetry`, HTTP interceptors (auth, 401 refresh, 429, ETag)               | [references/client-retry-interceptors.md](references/client-retry-interceptors.md) |
| SSE (`defineEventStream`) and WebSocket (`defineWebSocket`), `await using` / `closed` ownership, heartbeats, reconnects, subprotocols                               | [references/realtime-sse-ws.md](references/realtime-sse-ws.md)                     |
| `@defjs/react`, `@defjs/vue`, `@defjs/opentelemetry-server`, deterministic offline testing (`with*Handle`), in-app API layers (`src/api/`) and public SDK packaging | [references/integrations-and-testing.md](references/integrations-and-testing.md)   |

## Official documentation lookup (English, no locale slug)

1. **Check installed types first:** Inspect `node_modules/@defjs/*/dist/index.d.ts` for exact signatures and TSDoc matching the version installed in the project.
2. **Search or fetch official English docs when needed:** When you need deeper edge-case behavior, full API reference tables, or additional examples, fetch the English documentation on `https://defjs.lyz.cloud` directly. Always use the root paths **without** a locale prefix (do not add `/en-US/` or `/zh-Hans/`):
   - **LLM page index (start here to discover slugs):** `https://defjs.lyz.cloud/llms.txt`
   - **Single page as clean Markdown:** `https://defjs.lyz.cloud/llms.mdx/<slug>/content.md`
     - Guides: `docs/start`, `docs/struct`, `docs/http`, `docs/client`, `docs/load-balancing`, `docs/interceptors`, `docs/errors`, `docs/sse`, `docs/web-socket`, `docs/testing`, `docs/design-decisions`, `docs/best-practices`, `docs/application-api`, `docs/public-sdk`, `docs/integrations/react`, `docs/integrations/vue`, `docs/integrations/opentelemetry-server`
     - Recipes: `recipes/post-json`, `recipes/get-declared-404`, `recipes/cancel-http`, `recipes/refresh-bearer-once`, `recipes/etag-revalidate`, `recipes/consume-sse`, `recipes/websocket-session`, `recipes/test-with-handle`, `recipes/publish-http-sdk`
     - API overviews: `api/client`, `api/http`, `api/struct`, `api/errors`, `api/interceptors`, `api/sse`, `api/web-socket`, `api/react`, `api/vue`, `api/opentelemetry-server`
   - **All English guides in one file:** `https://defjs.lyz.cloud/llms-full.txt`
   - **Human web pages (English default):** `https://defjs.lyz.cloud/docs/<topic>` and `https://defjs.lyz.cloud/api/<entry>`

## Review checklist

- [ ] Definition modules (`defineRequest`, `defineEventStream`, `defineWebSocket`) do not import or create a client.
- [ ] Every definition with `input` has an explicit, synchronous, pure `builder`.
- [ ] `builder` performs no I/O, reads no auth tokens, and passes typed struct values (`body: input.order`) so `.alias(...)` applies.
- [ ] Every call site checks `if (error)` and returns before reading the success value; no `try/catch` is used expecting HTTP or network errors to throw.
- [ ] Derived clients carrying a `signal` (`client({ signal })`) are created per call, not shared across unrelated calls.
- [ ] Authentication, token refresh, `Retry-After`, and tracing live in interceptors (`withInterceptors`), not in `builder`.
- [ ] Retries are enabled with `withRetry`; `ReadableStream` bodies are never replayed.
- [ ] Every opened SSE stream and WebSocket session is closed with `await using` or `finally { close(); await closed; }`.
- [ ] React `useEffect` and Vue `watch` / `onScopeDispose` abort in-flight operations on cleanup and ignore late completions after abort.
- [ ] Typecheck and transport-handle unit tests (`withHTTPHandle`, `withSSEHandle`, `withWebSocketHandle`) pass.
