# HTTP requests (`defineRequest`)

Contents: [Define and execute](#define-and-execute) · [Input placement (`builder`)](#input-placement-builder) · [Query serialization](#query-serialization) · [Body encoding](#body-encoding) · [Cancellation and progress](#cancellation-and-progress)

## Define and execute

`defineRequest` declares a pure HTTP operation contract. Importing or calling `defineRequest` performs no I/O and captures no client. Calling the returned operation with a client starts the request and resolves to `[error, data, response]`.

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
  customerName: struct.string().alias("customer_name"),
});

export const updateOrder = defineRequest({
  method: "PATCH",
  operation: "orders.update",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    order: struct.object({
      status: struct.string(),
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    body: input.order,
  }),
  output: Order,
  error: struct.object({ message: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com/v1"));

async function main() {
  const [error, order, response] = await updateOrder(client, {
    id: 7,
    order: { status: "paid", customerName: "Ada" },
  });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.customerName, response.status);
}

void main();
```

- `output` decodes `2xx` responses; `error` decodes non-`2xx` responses. Only one side is ever read. If `output` or `error` is omitted, that side's body is not read at all.
- `operation` is a low-cardinality identifier (such as `"orders.update"`) used by interceptors and OpenTelemetry. Never put dynamic IDs or URLs in `operation`.

## Input placement (`builder`)

Whenever `input` is declared, `builder` is **required**. Defjs never infers placement from field names or `:param` placeholders. Only a definition without `input` may omit `builder`.

- `builder` is a synchronous pure function `(input) => ({ path?, query?, headers?, body? })`.
- If `builder` throws or returns an illegal placement, the call does not throw; it resolves to a `REQ_BUILD_FAILED` fault on the tuple.
- `path` values must be scalars. Each placeholder segment is percent-encoded once; empty strings, `.`, `..`, `null`, and `undefined` fail with `REQ_BUILD_FAILED`.
- `headers` values may be a scalar or an array of scalars. `undefined` header and query values are omitted; `null` in `path`, `query`, or `headers` fails with `REQ_BUILD_FAILED`.
- `GET` and `HEAD` definitions cannot return `body` from `builder` (compile-time type error).

```ts
// Incorrect: async builder or reading auth tokens in builder
defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: async (input) => ({
    path: input,
    headers: { authorization: `Bearer ${await readToken()}` },
  }),
});

// Correct: pure synchronous placement; put auth in an HTTP interceptor
defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
});
```

## Query serialization

The default query encoder accepts scalars and arrays of scalars (arrays repeat the key). Passing a nested object without a custom serializer returns `REQ_BUILD_FAILED`.

```ts
import { createClient, withEndpoint, withQuerySerializer } from "@defjs/core";

const client = createClient(
  withEndpoint("https://api.example.com"),
  withQuerySerializer((query) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" || typeof value === "number") {
        params.append(key, String(value));
      }
    }
    return params.toString();
  }),
);
```

- `query` passed to `withQuerySerializer` already has wire aliases applied, `Date` converted to ISO string, and `bigint` converted to string.
- If `builder` returns a `URLSearchParams` instance directly, `withQuerySerializer` is skipped.

## Body encoding

| `body` returned by `builder`                            | Payload sent                                 | Default `Content-Type`                                      |
| ------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| omitted / `undefined`                                   | No body                                      | None                                                        |
| Root struct created with `struct.urlencoded(...)`       | `URLSearchParams` (wire keys, arrays repeat) | `application/x-www-form-urlencoded;charset=UTF-8`           |
| Root struct created with `struct.formData(...)`         | `FormData` (wire keys, arrays repeat)        | Runtime multipart boundary (clears explicit `Content-Type`) |
| `FormData` or `URLSearchParams` instance                | Sent as-is                                   | Same as above                                               |
| `Blob` / `File`                                         | Sent as-is                                   | `blob.type` or `application/octet-stream`                   |
| `ArrayBuffer`, TypedArray, `DataView`, `ReadableStream` | Sent as-is / streamed                        | `application/octet-stream`                                  |
| `string`                                                | Raw text                                     | `text/plain;charset=UTF-8`                                  |
| Object, array, finite number, boolean, `null`           | Struct-encoded, then `JSON.stringify`        | `application/json`                                          |

- `NaN` and `±Infinity` in a JSON body fail with `REQ_BUILD_FAILED` before sending.
- A `string` body is sent as `text/plain;charset=UTF-8`. To send a pre-serialized JSON string, set `headers: { "content-type": "application/json" }` explicitly. Values serialized manually bypass struct alias encoding.

## Cancellation and progress

Pass per-call `RequestOptions` by deriving a client value at the call site: `getOrder(client({ signal, onDownloadProgress, onUploadProgress }), input)`.

- `AbortSignal.timeout(ms)` produces `NET_TIMEOUT` when it fires.
- Aborting your own `AbortController` produces `NET_ABORTED`.
- Never reuse a derived `client({ signal })` value across unrelated calls unless they intentionally share that signal.
- `onUploadProgress` converts `Blob`, `File`, `ArrayBuffer`, and `FormData` bodies into a stream where `fetch` accepts one (not Firefox, which sends them unchanged and never calls the callback), so Fetch's streaming-request rules apply, as they do to a `ReadableStream` you pass yourself. Chromium and WebKit fail on HTTP/1.1 with `NET_UNREACHABLE`; in browsers a cross-origin call needs a CORS preflight unless the browser holds a cached preflight result; a 301, 302, 307, or 308 redirect fails; browsers send no `Content-Length`; the load balancer receives `{ attempted: false }` for these failures, and for a source stream that throws, so a streamed upload alone cannot detect a down endpoint. For an endpoint that cannot accept that, omit `onUploadProgress`.
