# HTTP operations [#http-operations]

An SDK defines each HTTP operation with `defineRequest`: its method, path template, `input` schema, synchronous `builder`, and `output` / `error` response schemas. Consuming applications import the operation, pass their configured `Client`, and handle the returned `[error, data, response]` tuple.

## 1. Define the operation and call it [#1-define-the-operation-and-call-it]

Give each operation its own `defineRequest` export in your SDK module, and keep `createClient` in the consuming application:

<Tabs items={["sdk/orders.ts", "app/main.ts", "Single-file quick look"]}>
<Tab>

```typescript
import { defineRequest, struct } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
});

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: Order,
});
```

</Tab>
<Tab>

```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, order, response] = await getOrder(client, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status, response.status);
}

void main();
```

</Tab>
<Tab>

```typescript
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
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

</Tab>
</Tabs>

### SDK design best practices [#sdk-design-best-practices]

- **One operation per definition**: Keep each method, path, and contract in its own definition so applications can tree-shake unused operations.
- **Set a static `operation` name**: Use a low-cardinality identifier such as `"orders.read"`. Telemetry plugins (`@defjs/opentelemetry-server`) and logging interceptors use it without leaking URLs or user IDs.
- **Never embed a client in the SDK**: Export only definitions, `struct` schemas, and types.

## 2. URL resolution and path parameters [#2-url-resolution-and-path-parameters]

`withEndpoint(...)` requires a valid absolute URL. Its pathname acts as the base directory (any query string or hash on the base endpoint is discarded).

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com/v1"));
const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({
    path: { id: input.id },
    query: { fields: input.fields },
  }),
});

// → https://api.example.com/v1/orders/a%2Fb?fields=status

async function main() {
  const [error] = await getOrder(client, { id: "a/b", fields: "status" });
  if (error) {
    console.error(error.code);
    return;
  }
}

void main();
```

- **Path placeholders (`:name`)**: Encoded exactly once as a single path segment. Slashes, `?`, `#`, `%`, spaces, and Unicode stay inside that segment—do not pre-encode values. Empty strings, `.`, and `..` fail with `REQ_BUILD_FAILED`.
- **Origin and directory confinement**: Definition paths cannot be absolute URLs or protocol-relative (`//...`), cannot contain C0 control characters, backslashes, `?`, or `#`, and cannot escape the base endpoint's directory (`../`). Any violation fails with `REQ_BUILD_FAILED` before interceptors or transport run.

## 3. Placing input with `builder` [#3-placing-input-with-builder]

Whenever an operation declares `input`, it **must** provide a synchronous, pure `builder` returning `{ path?, query?, headers?, body? }`. Only operations without `input` may omit `builder`.

```typescript
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
  output: struct.object({
    id: struct.number(),
    customerName: struct.string().alias("customer_name"),
  }),
});

async function main() {
  const [error, order] = await updateOrder(client, {
    id: 7,
    requestId: "request-42",
    profile: { customerName: "Ada" },
  });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.id);
}

void main();
```

### How `builder` encodes field aliases [#how-builder-encodes-field-aliases]

| Builder expression                             | Wire output                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `body: input.profile`                          | Typed struct: `.alias()` and `Date` / `bigint` codecs apply           |
| `body: { profile: input.profile }`             | Outer key `profile` is literal; inner object keeps its struct aliases |
| `body: { ...input.profile, role: "admin" }`    | Spread preserves struct aliases; `role` is literal                    |
| `body: { name: input.profile.customerName }`   | Anonymous object: keys are literal                                    |
| `query: input.filter` / `headers: input.trace` | Flat typed objects: field `.alias()` becomes the wire key             |

### Custom query serialization [#custom-query-serialization]

By default, query scalars and scalar arrays (repeated keys) are encoded directly, while nested query objects fail with `REQ_BUILD_FAILED`. If your backend expects nested query syntax (`filter[status]=paid`), configure `withQuerySerializer` on the client:

```ts
import { createClient, withEndpoint, withQuerySerializer } from "@defjs/core";

const client = createClient(
  withEndpoint("https://api.example.com"),
  withQuerySerializer((query) => {
    const params = new URLSearchParams();
    const append = (key: string, value: unknown) => {
      if (Array.isArray(value)) {
        for (const item of value) append(key, item);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [child, nested] of Object.entries(value)) {
          append(`${key}[${child}]`, nested);
        }
        return;
      }
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
      )
        params.append(key, String(value));
    };
    for (const [key, value] of Object.entries(query)) append(key, value);
    return params.toString();
  }),
);
```

### Request body formats [#request-body-formats]

`GET` and `HEAD` cannot carry a body. For other methods, the body format is selected from the value returned by `builder`:

| `body` value                                                          | Sent on the wire as                              | Default `Content-Type`                    |
| --------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| `undefined` / omitted                                                 | No body                                          | —                                         |
| Root struct with `urlencoded` / `formData` codec                      | `URLSearchParams` / `FormData` (aliases applied) | Form type / multipart boundary            |
| Native `FormData` or `URLSearchParams`                                | Passed through as-is                             | Multipart boundary / urlencoded           |
| `Blob` / `File`                                                       | Passed through as-is                             | `blob.type` or `application/octet-stream` |
| `ArrayBuffer`, typed array, `DataView`, `ReadableStream`              | Raw bytes / stream                               | `application/octet-stream`                |
| `string`                                                              | UTF-8 text                                       | `text/plain;charset=UTF-8`                |
| Plain object, array, finite number, boolean, `null`, `Date`, `bigint` | Struct-encoded JSON                              | `application/json`                        |

```typescript
import { defineRequest, struct } from "@defjs/core";

const login = defineRequest({
  method: "POST",
  path: "/login",
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias("username"),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
});

const upload = defineRequest({
  method: "POST",
  path: "/files/:id",
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData();
    input.photos.forEach((photo, index) =>
      body.append("photo", photo, `photo-${index}.jpg`),
    );
    return { path: { id: input.id }, body };
  },
});
```

Values that cannot be represented in JSON (`NaN`, `±Infinity`, `Map`, `Set`, functions, class instances without `toJSON()`, or raw iterables) fail immediately with `REQ_BUILD_FAILED` instead of silently serializing as `{}` or `null`.

## 4. How responses are decoded [#4-how-responses-are-decoded]

`output` validates `2xx` responses; `error` validates non-`2xx` responses (`3xx`, `4xx`, `5xx`). The struct kind determines how the response stream is read (`struct.string()` → text, `struct.blob()` / `struct.file()` → `Blob`, `struct.arrayBuffer()` → `ArrayBuffer`, everything else → JSON):

1. **Select side by `ok` (`200..299`)**: `output` for `2xx`, `error` for non-`2xx`.
2. **Opt-out when omitted**: If no struct is declared for that side, the response body is never read (`2xx` resolves `data: undefined` + `HttpMeta`; non-`2xx` resolves `HTTP_STATUS` with `data: undefined`).
3. **Verify JSON media type first**: For JSON structs, a non-JSON `Content-Type` fails with `RES_MEDIA_TYPE_INVALID` before the body is read or looked for. A response without content (`HEAD`, `204`, `205`, `304`) is held to the declaration like any other.
4. **Read and parse**: Unreadable streams or invalid JSON fail with `RES_DECODE_FAILED` (or `NET_BODY_INCOMPLETE` if truncated mid-stream).
   A response without content (`HEAD`, `204`, `205`, `304`) has no body to read: `struct.string()` gets `''`, `struct.arrayBuffer()` an empty `ArrayBuffer`, and `struct.blob()` an empty `Blob`. A JSON struct that passed step 3 parses the empty bytes, which fails with `RES_DECODE_FAILED`.
5. **Validate with `struct`**: Schema mismatches fail with `RES_STRUCT_MISMATCH`.

## 5. Cancel the work and set deadlines [#cancel-the-work]

Pass `signal` on a per-call derived client: `client({ signal })`.

- **Deadlines (`NET_TIMEOUT`)**: Use `AbortSignal.timeout(ms)`.
- **Manual cancellation (`NET_ABORTED`)**: Use `AbortController`.
- **Combined signals**: Use `AbortSignal.any([controller.signal, AbortSignal.timeout(ms)])`.

<Tabs items={["Deadline (NET_TIMEOUT)", "Manual cancel (NET_ABORTED)"]}>
<Tab>

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

async function main() {
  const [error, order] = await getOrder(
    client({ signal: AbortSignal.timeout(5_000) }),
    { id: 1 },
  );
  if (error?.code === "NET_TIMEOUT") {
    console.error("timed out");
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
```

</Tab>
<Tab>

```ts
import { createClient, defineRequest, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getReport = defineRequest({ method: "GET", path: "/report" });

async function main() {
  const controller = new AbortController();
  const pending = getReport(
    client({
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
    }),
  );

  controller.abort("screen closed");
  const [error] = await pending;
  if (error?.code === "NET_ABORTED") {
    console.log("caller cancellation");
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
}

void main();
```

</Tab>
</Tabs>

Canceling a write request only reports that the caller stopped waiting—it does not guarantee that the server rolled back the mutation.

## 6. Credentials, XSRF, and transfer progress [#6-credentials-xsrf-and-transfer-progress]

- **`withCredentials(true)`**: Sets Fetch `credentials: "include"` for HTTP and SSE requests.
- **`withXSRF(options?)`**: From `@defjs/core/xsrf`. In a browser, reads the XSRF cookie (`XSRF-TOKEN` by default) and injects the header (`X-XSRF-TOKEN`) on same-origin mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`). Calling `withXSRF()` throws when `location` or `document` is missing, including in a Worker. Isomorphic code adds this option only in the browser. A token from another source is set with an interceptor. The same-origin check applies to the URL the library builds; Fetch follows redirects itself and keeps this header after a redirect to another origin (it removes only `Authorization`). To refuse that, see [`withXSRF`](/api/core/withxsrf).
- **`onDownloadProgress` / `onUploadProgress`**: Pass on `client({ onDownloadProgress, onUploadProgress })`. Download progress reports `lengthComputable: true` only when `Content-Length` is positive and `Content-Encoding` is absent or `identity`. Upload progress is reported only when the request body is a `ReadableStream` that you pass; every other body (`Blob`, `File`, `ArrayBuffer`, `FormData`, a string, `URLSearchParams`) is sent as built and `onUploadProgress` is not called, on every runtime. A `ReadableStream` body follows the Fetch rules for streaming request bodies, with or without `onUploadProgress`: Chromium and WebKit accept it only over HTTP/2 or later, so the call fails with `NET_UNREACHABLE` on HTTP/1.1 (Node.js and Bun accept HTTP/1.1); Firefox cannot stream request bodies and fails with `ENV_UNSUPPORTED`; in browsers a cross-origin request needs a CORS preflight unless the browser holds a cached preflight result; and a 301, 302, 307, or 308 redirect fails. Browsers send no `Content-Length`. The load balancer receives `{ attempted: false }` for these failures, and for a source stream that throws, because `fetch` reports them as the same network error as an unreachable endpoint; a streamed upload alone therefore cannot detect a down endpoint. See the `HttpProgressFn` entry in the API reference for details. A throwing progress callback fails the call with `EXT_OBSERVER_FAILED`.

## Related reading [#related-reading]

- [Send and validate JSON](/recipes/post-json)
- [Handle a declared 404](/recipes/get-declared-404)
- [Cancel an HTTP call](/recipes/cancel-http)
- [Test with a local Fetch handle](/recipes/test-with-handle)
