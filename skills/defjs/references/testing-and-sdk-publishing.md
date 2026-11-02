# Testing, publishing SDKs, and review checklist

Contents: [Deterministic testing with transport handles](#deterministic-testing-with-transport-handles) · [Authoring and publishing an SDK package](#authoring-and-publishing-an-sdk-package) · [What Defjs does not provide](#what-defjs-does-not-provide) · [Code review checklist](#code-review-checklist)

## Deterministic testing with transport handles

Do not mock `defineRequest` or stub the operation function. Instead, test through the real validation, `builder`, status dispatch, and struct decoding pipeline by injecting a local transport handle (`withHTTPHandle`, `withSSEHandle`, or `withWebSocketHandle`):

```ts
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

const testClient = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async (input, init) => {
    const request = new Request(input, init);
    const id = new URL(request.url).pathname.split("/").at(-1);
    if (id === "7") {
      return Response.json({ id: 7, status: "paid" }, { status: 200 });
    }
    return Response.json({ message: "Order not found" }, { status: 404 });
  }),
);

async function verifyGetOrder() {
  const [error, order, response] = await getOrder(testClient, { id: 7 });
  if (error) throw error;
  console.log(order.status, response.status);
}

void verifyGetOrder();
```

## Authoring and publishing an SDK package

An SDK package owns **only** the operation definitions and shared structs. It never creates or exports a client, never hardcodes a deployment URL, and never reads environment credentials.

```ts
// src/orders.ts — published in @company/orders-sdk
import { defineRequest, struct } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

export const getOrder = defineRequest({
  method: "GET",
  operation: "orders.get",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: Order,
  error: struct.object({ message: struct.string() }),
});
```

- Declare `@defjs/core` under `peerDependencies` (and `devDependencies` for local typecheck/tests) in the SDK's `package.json` so the consuming application and the SDK share a compatible Core contract.
- Export TypeScript declarations (`types`) alongside ESM output.

## What Defjs does not provide

| Not provided                                              | What to use instead                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| A global client singleton                                 | Application-owned `createClient(...)` passed to operations                  |
| A client method that executes a command                   | Call the operation directly: `getOrder(client, input)`                      |
| Client-level default timeout or `timeout`/`abort` options | `client({ signal: AbortSignal.timeout(ms) })` or `AbortController`          |
| A `responseType` field on `defineRequest`                 | The struct kind of `output` (`string`, `blob`, `arrayBuffer`, or JSON)      |
| `.parse()` on a struct instance or `struct.encode`        | `struct.parse(schema, value)` and `builder` placement                       |
| Custom WebSocket handshake headers                        | Cookies, short-lived query tickets, or `protocols`                          |
| WebSocket message map or type envelope                    | `struct.discriminatedUnion` and `session.onRuntimeError`                    |
| OpenAPI code generation                                   | Keep OpenAPI as the external spec or validate at the boundary with `struct` |

## Code review checklist

- [ ] Definition modules (`defineRequest`, `defineEventStream`, `defineWebSocket`) do not import or create a client.
- [ ] Every definition with `input` has an explicit, synchronous, pure `builder`.
- [ ] `builder` performs no I/O, reads no auth tokens, and passes typed struct objects (`body: input.order`) so `.alias(...)` applies.
- [ ] Every call site checks `if (error)` and returns before reading the success value.
- [ ] Call sites are not wrapped in `try/catch` expecting HTTP/network errors to throw (they resolve on the tuple).
- [ ] Derived clients carrying a `signal` (`client({ signal })`) are created per call, not shared across unrelated calls.
- [ ] Authentication, token refresh, retries, and tracing live in interceptors (`withInterceptors`), not in `builder`.
- [ ] Retries only replay safe methods (`GET`, `HEAD`, `OPTIONS`) with replayable bodies and respect `request.signal`.
- [ ] Every opened SSE stream (`defineEventStream`) and WebSocket session (`defineWebSocket`) is closed via `await using` or `finally { close(); await closed; }`.
- [ ] React `useEffect` and Vue `watch` / `onScopeDispose` abort in-flight operations on cleanup and ignore late completions after abort.
