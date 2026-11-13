# HTTP Requests, Struct Schemas, and Fault Handling

Contents: [Struct schemas and modifiers](#1-struct-schemas-and-modifiers) · [Wire aliases and `struct.parse`](#2-wire-aliases-and-structparse) · [Recursive structs](#3-recursive-structs) · [Defining HTTP operations (`defineRequest`)](#4-defining-http-operations-definerequest) · [`builder` placement rules](#5-builder-placement-rules) · [Query serialization](#6-query-serialization) · [Body encoding and `Content-Type` dispatch](#7-body-encoding-and-content-type-dispatch) · [Cancellation, timeouts, and transfer progress](#8-cancellation-timeouts-and-transfer-progress) · [Error-first tuples and `Fault` handling](#9-error-first-tuples-and-fault-handling)

For full English guide pages on the official site (no locale prefix), fetch `https://defjs.lyz.cloud/llms.mdx/docs/struct/content.md`, `https://defjs.lyz.cloud/llms.mdx/docs/http/content.md`, and `https://defjs.lyz.cloud/llms.mdx/docs/errors/content.md`.

---

## 1. Struct schemas and modifiers

Every protocol boundary (`input`, `output`, `error`, SSE `events`, WebSocket `incoming`/`outgoing`) accepts only `@defjs/core` structs. `struct` declares structure only—string lengths, regexes, number ranges, and business rules belong in application code after parsing.

| Constructor                                                               | Accepts                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `struct.string()`, `struct.number()`, `struct.boolean()`, `struct.null()` | Primitives (`NaN` is rejected for `number`)                              |
| `struct.bigint()`, `struct.date()`                                        | `bigint` or numeric string; `Date`, finite timestamp, or ISO/date string |
| `struct.literal(value)`, `struct.enum(values)`                            | Exact literal; readonly string array or `{ Key: value }` enum object     |
| `struct.any()`, `struct.unknown()`                                        | Any value except `null` and `undefined` (opaque, not traversed)          |
| `struct.array(item)`, `struct.tuple([a, b])`                              | Homogeneous array; fixed-length tuple                                    |
| `struct.object(shape)`, `struct.record(value)`                            | Fixed-field object (unknown keys are stripped); string-keyed dictionary  |
| `struct.or(a, b)`, `struct.intersection(a, b)`                            | First matching branch; merged object branches                            |
| `struct.discriminatedUnion(tag, [optA, optB])`                            | Object union dispatched in $O(1)$ by the literal `tag` field             |
| `struct.urlencoded(shape)`, `struct.formData(shape)`                      | Object struct tagged for form encoding when used as the HTTP body root   |
| `struct.blob()`, `struct.file()`, `struct.arrayBuffer()`                  | Binary values                                                            |

Chainable modifiers on every struct:

- `.optional()` — allows `undefined` or an omitted object property.
- `.null()` / `.nullable()` — allows `null`.
- `.nullish()` — allows `null`, `undefined`, or an omitted object property.
- `.alias(wireName)` — maps the TypeScript property name (logical key) to `wireName` on the wire.

### Best practice: declare reusable schemas and infer TypeScript types

```ts
import { struct, type Infer } from "@defjs/core";

export const OrderItem = struct.object({
  sku: struct.string(),
  quantity: struct.number(),
});

export const Order = struct.object({
  id: struct.number(),
  status: struct.enum(["pending", "paid", "shipped"]),
  customerName: struct.string().alias("customer_name"),
  items: struct.array(OrderItem),
  metadata: struct.record(struct.string()).optional(),
  paidAt: struct.date().nullable(),
});

export type Order = Infer<typeof Order>;
```

---

## 2. Wire aliases and `struct.parse`

Structs have **no** instance `.parse()` method and **no** `struct.encode`. Always call `struct.parse(schema, value, options?)`, which fails fast on the first invalid field and returns `[null, data]` or `[StructError, undefined]`.

| Boundary                                                      | Key expected / produced                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `struct.parse(Order, value)` (default)                        | Expects logical key (`customerName`)                                   |
| `struct.parse(Order, value, { aliases: true })`               | Expects wire key (`customer_name`) → outputs logical key               |
| Operation `input` and `builder` parameter                     | Uses logical key (`input.customerName`)                                |
| Typed struct object returned from `builder` (`body`, `query`) | Automatically encoded to wire key (`customer_name`)                    |
| Inbound `output`, `error`, SSE `events`, WebSocket `incoming` | Automatically decoded from wire key (`customer_name`) → `customerName` |

### Best practice: standalone parsing and keeping typed objects intact in `builder`

```ts
import { defineRequest, struct } from "@defjs/core";

const NewOrder = struct.object({
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

export function parseWireOrder(raw: unknown) {
  const [error, order] = struct.parse(NewOrder, raw, { aliases: true });
  if (error) {
    console.error(error.prettify());
    return undefined;
  }
  return order;
}

// Wrong: rebuilding a plain object with wire keys bypasses struct alias metadata
export const badPostOrder = defineRequest({
  method: "POST",
  path: "/orders",
  input: struct.object({ order: NewOrder }),
  builder: (input) => ({
    body: {
      status: input.order.status,
      customer_name: input.order.customerName,
    },
  }),
});

// Right: pass the typed struct value directly so Defjs encodes aliases across the tree
export const postOrder = defineRequest({
  method: "POST",
  meta: { operation: "orders.create" },
  path: "/orders",
  input: struct.object({ order: NewOrder }),
  builder: (input) => ({ body: input.order }),
});
```

---

## 3. Recursive structs

A self-referential type references itself through a `get` property on the shape object. The object struct runs its getters once when it is first used (not when the constant is defined) and caches the fields. Always annotate the constant with `Struct<T>` because TypeScript cannot infer a self-referential return type.

### Best practice: recursive schema definition

```ts
import { struct, type Struct } from "@defjs/core";

export interface Category {
  name: string;
  children: Category[];
}

export const CategoryStruct: Struct<Category> = struct.object({
  name: struct.string(),
  get children() {
    return struct.array(CategoryStruct);
  },
});
```

---

## 4. Defining HTTP operations (`defineRequest`)

`defineRequest` declares a single HTTP operation. Keep one operation per definition so consumers can tree-shake unused endpoints.

- **`meta`**: Optional `{ [key: string]: unknown }`, application-defined context such as `{ operation: "orders.update" }`. It reaches interceptors (`request.meta`) and balancers (`PickInfo.meta`) only; Defjs never reads it or sends it over the network.
- **`output` and `error`**: `output` decodes `2xx` responses; `error` decodes non-`2xx` responses. Only one side is ever read. If `output` or `error` is omitted, that side's response body is not read at all.
- **Empty responses (`HEAD`, `204`, `205`, `304`)**: Read as zero bytes. `struct.string()` yields `""`, `struct.arrayBuffer()` yields an empty `ArrayBuffer`, and `struct.blob()` yields an empty `Blob`. A JSON struct still checks for a JSON `Content-Type` first (`RES_MEDIA_TYPE_INVALID` if missing) and then fails on empty bytes with `RES_DECODE_FAILED`—omit `output` on a `204 No Content` endpoint instead of declaring a JSON object.

### Best practice: PATCH request with path + body placement and typed output/error

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

export const updateOrder = defineRequest({
  method: "PATCH",
  meta: { operation: "orders.update" },
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    patch: struct.object({
      status: struct.string(),
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    body: input.patch,
  }),
  output: Order,
  error: struct.object({ message: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com/v1"));

async function main() {
  const [error, order, response] = await updateOrder(client, {
    id: 7,
    patch: { status: "paid", customerName: "Ada" },
  });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.customerName, response.status);
}

void main();
```

---

## 5. `builder` placement rules

Whenever `input` is declared, `builder` is **required**. Only a definition without `input` may omit `builder`.

- **Synchronous and pure**: `builder` has signature `(input) => ({ path?, query?, headers?, body? })`. If `builder` throws or returns an illegal placement, the operation resolves to `[Fault, undefined, undefined]` with `error.code === "REQ_BUILD_FAILED"`.
- **`path`**: Values must be scalars (`string | number | bigint | boolean`). Each `:param` segment is percent-encoded once. Empty strings `""`, `"."`, `".."`, `null`, and `undefined` fail with `REQ_BUILD_FAILED`.
- **`query`**: Default encoder accepts scalars and arrays of scalars (arrays repeat the key; `undefined` values are omitted; `null` or nested objects without `withQuerySerializer` fail with `REQ_BUILD_FAILED`).
- **`headers`**: Accepts `Headers`, `[name, value][]`, or a record of scalars and scalar arrays (`["a", "b"]` joins as `"a,b"`; `undefined` values are omitted; invalid header bytes fail with `REQ_BUILD_FAILED`).
- **`body`**: Forbidden on `GET` and `HEAD` (compile-time error and runtime `REQ_BUILD_FAILED`).

```ts
// Wrong: async builder or reading auth tokens in builder
defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: async (input) => ({
    path: input,
    headers: { authorization: `Bearer ${await readToken()}` },
  }),
});

// Right: pure synchronous placement; put auth in createHttpInterceptor
defineRequest({
  method: "GET",
  meta: { operation: "orders.get" },
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
});
```

---

## 6. Query serialization

- When `builder` returns a `URLSearchParams` instance as `query`, `withQuerySerializer` is skipped and the instance is copied directly into `request.query`.
- When `builder` returns a struct-validated object, `query` passed to `withQuerySerializer(fn)` already has wire `.alias()` keys applied, `Date` converted to ISO strings, and `bigint` converted to strings. The string returned by `fn` is parsed into `request.query` (`URLSearchParams`) and serialized via the URL Standard's `query.toString()`.

### Best practice: custom query serializer for nested filter objects

```ts
import { createClient, withEndpoint, withQuerySerializer } from "@defjs/core";

export const client = createClient(
  withEndpoint("https://api.example.com"),
  withQuerySerializer((query) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && typeof value === "object" && value !== null) {
        params.set(key, JSON.stringify(value));
      } else if (value !== undefined) {
        params.append(key, String(value));
      }
    }
    return params.toString();
  }),
);
```

---

## 7. Body encoding and `Content-Type` dispatch

| `body` returned by `builder`                            | Wire payload sent                            | Default `Content-Type`                                      |
| ------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| omitted / `undefined`                                   | No body                                      | None                                                        |
| Root struct created with `struct.urlencoded(shape)`     | `URLSearchParams` (wire keys, arrays repeat) | `application/x-www-form-urlencoded;charset=UTF-8`           |
| Root struct created with `struct.formData(shape)`       | `FormData` (wire keys, arrays repeat)        | Runtime multipart boundary (clears explicit `Content-Type`) |
| `URLSearchParams` or `FormData` instance                | Sent as-is                                   | Same as above                                               |
| `Blob` / `File`                                         | Sent as-is                                   | `blob.type` or `application/octet-stream`                   |
| `ArrayBuffer`, TypedArray, `DataView`, `ReadableStream` | Sent as-is / streamed                        | `application/octet-stream`                                  |
| `string`                                                | Raw UTF-8 text                               | `text/plain;charset=UTF-8`                                  |
| Object, array, finite number, boolean, `null`           | Struct-encoded, then `JSON.stringify`        | `application/json`                                          |

- `struct.urlencoded(...)` and `struct.formData(...)` tags apply **only when that struct is the root of `body`**. When nested inside another object, they serialize as regular JSON objects.
- `NaN` and `±Infinity` in a JSON body fail with `REQ_BUILD_FAILED` before sending.
- Response decoding mirrors the `output` / `error` struct kind: `struct.string()` reads text, `struct.blob()` / `struct.file()` reads a `Blob`, `struct.arrayBuffer()` reads an `ArrayBuffer`, and every other struct parses JSON.

### Best practice: multipart `FormData` upload with `struct.formData`

```ts
import { defineRequest, struct } from "@defjs/core";

export const uploadInvoice = defineRequest({
  method: "POST",
  meta: { operation: "invoices.upload" },
  path: "/invoices",
  input: struct.formData({
    orderId: struct.string().alias("order_id"),
    document: struct.file(),
  }),
  builder: (input) => ({ body: input }),
  output: struct.object({ receiptId: struct.string() }),
});
```

---

## 8. Cancellation, timeouts, and transfer progress

Pass per-call `RequestOptions` by deriving a single-call client value inline: `operation(client({ signal, onDownloadProgress, onUploadProgress }), input)`.

- **Timeouts vs caller aborts**: `AbortSignal.timeout(ms)` (or aborting with a `TimeoutError` `DOMException`) resolves to `error.code === "NET_TIMEOUT"`. Aborting your own `AbortController` resolves to `error.code === "NET_ABORTED"`. Combine both with `AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)])`.
- **Upload progress**: `onUploadProgress` is called **only** when the request body is a `ReadableStream` you pass. Built bodies (`Blob`, `File`, `FormData`, `string`, JSON) are sent at once without calling `onUploadProgress`. Note that `ReadableStream` request bodies are never retried, fail on HTTP/1.1 in Chromium/WebKit (`NET_UNREACHABLE`), and are unsupported in Firefox (`ENV_UNSUPPORTED`).

### Best practice: combined manual abort and deadline timeout

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getReport = defineRequest({
  method: "GET",
  meta: { operation: "reports.get" },
  path: "/reports/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ url: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

export async function fetchReport(id: number, userCancel: AbortSignal) {
  const signal = AbortSignal.any([userCancel, AbortSignal.timeout(5_000)]);
  const [error, report] = await getReport(client({ signal }), { id });
  if (error) {
    if (error.code === "NET_ABORTED") return undefined;
    if (error.code === "NET_TIMEOUT") {
      console.warn("Report request timed out");
      return undefined;
    }
    console.error(error.code, error.message);
    return undefined;
  }
  return report.url;
}
```

---

## 9. Error-first tuples and `Fault` handling

| Protocol                      | Success tuple                        | Failure tuple                                                   |
| ----------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| HTTP (`defineRequest`)        | `[null, data, response]`             | `[Fault<TError>, undefined, undefined]`                         |
| SSE (`defineEventStream`)     | `[null, stream, startupOpen]`        | `[Fault<TError>, undefined, startupOpen \| undefined]`          |
| WebSocket (`defineWebSocket`) | `[null, session, startupConnection]` | `[Fault<undefined>, undefined, startupConnection \| undefined]` |

`Fault<TError>` (and `AnyFault`) is a discriminated union keyed by `error.code`:

| `error.code`             | Variant                   | Extra fields                                  | Meaning                                                                                                                       |
| ------------------------ | ------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `REQ_INPUT_INVALID`      | `PreflightFault`          | `cause` (`StructError`)                       | Caller input failed the `input` struct                                                                                        |
| `REQ_BUILD_FAILED`       | `PreflightFault`          | `cause`                                       | `builder` threw, returned invalid path/query/headers/body, or platform refused to construct the request                       |
| `NET_UNREACHABLE`        | `PreflightFault`          | `cause`                                       | DNS, socket, TLS, or CORS failure before receiving a valid response                                                           |
| `NET_BODY_INCOMPLETE`    | `PreflightFault`          | `response?`, `cause`                          | Response body stream broke mid-transfer                                                                                       |
| `NET_TIMEOUT`            | `PreflightFault`          | `cause`                                       | `AbortSignal.timeout(ms)` or `TimeoutError` aborted the call                                                                  |
| `NET_ABORTED`            | `PreflightFault`          | `cause`                                       | Caller aborted the `AbortSignal`                                                                                              |
| `HTTP_STATUS`            | `HttpStatusFault<TError>` | `status`, `data`, `response`                  | Non-2xx response; `data` is the decoded `error` struct, or `undefined` if no `error` struct was declared                      |
| `RES_MEDIA_TYPE_INVALID` | `DecodeFault`             | `status`, `response`, `cause`                 | `Content-Type` does not match the declared JSON or `text/event-stream` representation                                         |
| `RES_DECODE_FAILED`      | `DecodeFault`             | `status`, `response`, `cause`                 | Response body could not be read or `JSON.parse`d (including empty bytes on a JSON struct)                                     |
| `RES_STRUCT_MISMATCH`    | `DecodeFault`             | `status`, `response`, `cause` (`StructError`) | Response body failed the declared `output` or `error` struct (if a non-2xx body fails `error`, you get `RES_STRUCT_MISMATCH`) |
| `EXT_INTERCEPTOR_FAILED` | `PreflightFault`          | `cause`                                       | An interceptor threw or passed `next()` a non-`AbortSignal` `signal`                                                          |
| `EXT_HOOK_FAILED`        | `PreflightFault`          | `cause`                                       | `beforeConnect`, `shouldRetry`, or `finalizeHeaders` threw                                                                    |
| `EXT_OBSERVER_FAILED`    | `PreflightFault`          | `cause`                                       | `onUploadProgress` or `onDownloadProgress` threw                                                                              |
| `CAP_BUFFER_EXCEEDED`    | `PreflightFault`          | —                                             | SSE frame buffer before a blank line exceeded `maxBufferSize`                                                                 |
| `ENV_UNSUPPORTED`        | `PreflightFault`          | —                                             | Runtime lacks default `fetch` / `WebSocket` or cannot stream a `ReadableStream` request body                                  |

### Best practice: narrowing declared `HTTP_STATUS` errors and triaging `StructError`

When `defineRequest` declares an `error` struct, narrowing `error.code === "HTTP_STATUS"` guarantees `error.data` matches `Infer<typeof errorStruct>` (because a malformed error body produces `RES_STRUCT_MISMATCH` instead):

```ts
import {
  createClient,
  defineRequest,
  StructError,
  struct,
  withEndpoint,
  type AnyFault,
} from "@defjs/core";

const OrderError = struct.discriminatedUnion("kind", [
  struct.object({
    kind: struct.literal("not_found"),
    orderId: struct.number(),
  }),
  struct.object({
    kind: struct.literal("rate_limit"),
    retryAfterSeconds: struct.number(),
  }),
]);

const getOrder = defineRequest({
  method: "GET",
  meta: { operation: "orders.get" },
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: OrderError,
});

export function formatFault(fault: AnyFault): string {
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify());
  }
  return `[${fault.code}] ${fault.message}`;
}

const client = createClient(withEndpoint("https://api.example.com"));

export async function loadOrder(id: number) {
  const [error, order] = await getOrder(client, { id });
  if (error) {
    if (error.code === "HTTP_STATUS") {
      switch (error.data.kind) {
        case "not_found":
          return `Missing order #${error.data.orderId}`;
        case "rate_limit":
          return `Retry in ${error.data.retryAfterSeconds}s`;
      }
    }
    return formatFault(error);
  }
  return order.status;
}
```
