# `@defjs/core` Usage Manual

> The structural contract is defined by `src/struct/README.md` and `src/struct/public_api.ts`. Which segment a request goes into is decided by the endpoint's `builder`; encoding is driven by the typed values handed over. `struct` only exposes structural declarations and `.alias(name)`; there is no public `struct.encode`.

This document keeps only the APIs that are currently used most often. Site documentation is in the repository `doc/`.

Defjs's purpose is to make SDKs easier to design, write, and deliver. `def` stands for `define`: the SDK author defines the API contract and exports endpoints; the application creates its own Client and decides the service address, authentication, transport configuration, and call lifecycle. A definition can be published as a standalone npm package and is not bound to any application's Client; both sides still follow Defjs's execution contract and compatible version requirements.

Full reading path: first see the separated definition module and calling application in `doc/content/zh-Hans/docs/start.mdx`, then see the packaging and publishing approach in `doc/content/zh-Hans/recipes/publish-http-sdk.mdx`. The rest of this document is looked up by API category.

## Quick start

### Create a client

```ts
import { createClient, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com/v1"));
```

`endpoint` is the base address. Internally it is parsed with `new URL(endpoint)` first, then the `path` from the definition is joined. The pathname is treated as a directory; query and hash on the base address are dropped.

For example:

```ts
endpoint = "https://api.example.com/v1";
path = "/user/info";
```

The final request URL is:

```ts
https://api.example.com/v1/user/info
```

## Client rules

`client` is an executor that is created and passed explicitly:

```ts
const [error, result] = await client.execute(command, options);
```

`defineRequest` / `defineEventStream` / `defineWebSocket` return an **endpoint**. Calling the endpoint yields one command; `client.execute(command, options)` runs it. There is no `.with({ client })`.

`createGlobalClient` / `getGlobalClient` / `setGlobalClient` / `resetGlobalClient` were removed in 0.4. When multiple external APIs are needed, create multiple `Client` instances separately.

## Struct

An endpoint's `input`, `output`, `error`, SSE `events`, and WebSocket `incoming` / `outgoing` accept only `struct` from `@defjs/core`.

Two hard rules:

1. Fail strictly and stop. A missing required field, a wrong type, or a wrong tuple length fails at the first determined problem. There is no zero-value filling and no partial result.
2. When `output` or `error` is omitted, that side's body is not read at all.

`struct.parse(schema, input)` lives on the facade and returns an error-first pair. A Struct instance has no `.parse()` and no `encode`. There is no `setErrorMap`.

### Constructors

```ts
struct.string()
struct.number()
struct.boolean()
struct.null()
struct.any()
struct.unknown()
struct.bigint()
struct.date()
struct.literal('x')
struct.enum(['a', 'b'])
struct.blob()
struct.file()
struct.arrayBuffer()

struct.array(item)
struct.object({ ... })
struct.record(valueStruct)
struct.tuple([a, b, c])
struct.or(a, b)
struct.intersection(a, b)
struct.discriminatedUnion('type', [optionA, optionB])

struct.urlencoded({ userName: struct.string().alias('username') })
struct.formData({ photo: struct.file() })
```

`urlencoded` and `formData` are still object structs; they only add a codec tag. The tag takes effect only when this value is the **body root**; once nested inside another JSON object, it is an ordinary object field. There is no `struct.request`, `struct.json`, or `struct.text`.

Field chain: `.optional()`, `.nullable()`, `.nullish()`, `.alias(name)`. `.alias` only changes the external wire name; it does not change the TypeScript property name.

Recursive objects use getter fields; the getter is read only when the boundary is parsed.

The validation DSL, string lengths, and business rules belong in the application layer. Unknown fields are ignored.

## Request placement

`builder` is a synchronous pure function. It receives the parsed real values and returns `{ path?, query?, headers?, body? }`. It runs when the command executes. A thrown error becomes `REQ_BUILD_FAILED` on the tuple; calling the endpoint itself does not throw.

`defineRequest`, `defineEventStream`, and `defineWebSocket` must explicitly provide a `builder` whenever `input` is declared. `input` only defines the input parameters; where each value is placed is decided only by the builder, and the library does not infer placement from input field names or the path template. Only a definition with no `input` may omit `builder`.

```ts
import { defineRequest, struct } from "@defjs/core";

const UserBody = struct.object({
  displayName: struct.string().alias("display_name"),
});

const updateUser = defineRequest({
  method: "PATCH",
  path: "/users/:id",
  input: struct.object({
    id: struct.number(),
    user: UserBody,
  }),
  builder: (input) => ({ path: { id: input.id }, body: input.user }),
  output: UserBody,
});

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: UserBody,
});
```

The calls are `updateUser({ id: 7, user: { displayName: 'Ada' } })` and `getUser({ id: 7 })` respectively. Prefer handing over typed values: `body: input.user` applies aliases across the whole tree. Keys of an object you write yourself are literal wire keys, and aliases do not apply. A spread keeps the struct; a logical key and a wire key appearing at the same time is `REQ_BUILD_FAILED`.

`path` values must be scalars. A header value may be a scalar or an array of scalars. `null` in path, query, or headers is `REQ_BUILD_FAILED`. `undefined` query and header values are omitted; an `undefined` or missing path placeholder is `REQ_BUILD_FAILED`. A `nullable` `null` is sent. Path placeholders are raw scalars, and each segment is encoded only once; empty values and `.` / `..` are rejected.

### Query

The default encoder accepts scalars and arrays of scalars (the array repeats the key). A nested object without a serializer is `REQ_BUILD_FAILED`.

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

`query` is already an encoded on-the-wire object; aliases, ISO for `Date`, and a string for `bigint` have already been applied. The returned string is stored as `queryString`, then assigned to `URL.search`, which percent-encodes spaces, `#`, quotes, and non-ASCII. The serializer is not called when there is no query. When the builder returns `URLSearchParams` directly, the serializer is skipped, and the interceptor sees that same instance; otherwise `queryParams` is `new URLSearchParams(queryString)`. Defjs does not ship a nested-query encoder.

### Body

By the first matching rule:

| `body`                                                    | Content sent                                                                 | Default Content-Type                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| omitted / `undefined`                                     | no body                                                                      | none added                                                                  |
| object with an `urlencoded` or `formData` tag on the root | `URLSearchParams` / `FormData`; keys are wire names; arrays repeat the field | form type / platform boundary; `formData` clears an existing `Content-Type` |
| `FormData`, `URLSearchParams`                             | as-is                                                                        | same as above; `FormData` clears an existing `Content-Type`                 |
| `Blob` / `File`                                           | as-is                                                                        | `blob.type`, otherwise `application/octet-stream`                           |
| `ArrayBuffer`, TypedArray, `DataView`                     | as-is                                                                        | `application/octet-stream`                                                  |
| `ReadableStream`                                          | streamed                                                                     | `application/octet-stream`                                                  |
| `string`                                                  | original text                                                                | `text/plain;charset=UTF-8`                                                  |
| object, array, finite number, boolean, `null`             | encoded, then `JSON.stringify`; `NaN` and `±Infinity` are `REQ_BUILD_FAILED` | `application/json`                                                          |

A `content-type` written in `headers` by the builder overrides the detected result, but a native `FormData` and an object with a `formData` tag on the root clear an existing `Content-Type` so the runtime can generate the multipart boundary. A string is original text; to send a JSON string you must `JSON.stringify` it yourself and include `application/json`. A `JSON.stringify`, `qs`, or protobuf you produce yourself has left struct encoding, and aliases are not applied.

HTTP interceptors see only explicit type headers; automatic types are applied just before the final send. An explicit `Content-Type` header wins over `bodyContentType`, which applies only while `bodyContentTypeSource` is still the current body. Replacing the body without updating that source detects the new body again. When nothing is declared, detection runs again, and `body: undefined` does not add an automatic header. `bodyContentType: null` removes the library's type header, but native Fetch may still add a type for a string. Server upload progress converted to a stream keeps the explicit type; FormData uses the actually serialized stream and its boundary, and is not read entirely into a Blob first; when there is no valid explicit `Content-Length`, the total is unknown.

`GET` / `HEAD` cannot return a body; that is a type error. A WebSocket builder cannot return `headers` or `body`.

## HTTP

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({
    id: struct.number(),
    displayName: struct.string().alias("display_name"),
  }),
  error: struct.object({ message: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const command = getUser({ id: 7 });
  const [error, data, response] = await client.execute(command, {
    timeout: 10_000,
  });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(data.displayName, response.status);
}

void main();
```

`output` is one struct for 2xx; `error` is one struct for the other statuses. `ok` is the only branch, and only one side is decoded. The representation is decided by kind: `string` is original text, `blob` / `file` is a Blob, `arrayBuffer` is bytes, and everything else is JSON. There is no `responseType`.

Success is `[null, data, response]`. Failure is `[error, undefined, undefined]`, and metadata is on the fault. A non-2xx whose `error` decodes successfully is `HTTP_STATUS`; a media type that does not match is `RES_MEDIA_TYPE_INVALID` (before the body is read); a representation that cannot be read is `RES_DECODE_FAILED`; a struct that does not match is `RES_STRUCT_MISMATCH`. A transport failure is a fault, not a response with status 0.

`abort` and `timeout` in the execution options are mutually exclusive, and either can also be combined with `signal`. An illegal timeout, or both appearing together, is `REQ_OPTIONS_INVALID`. An input that fails the struct is `REQ_INPUT_INVALID`.

## SSE

```ts
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const watchUser = defineEventStream({
  method: "GET",
  path: "/users/:id/events",
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  error: struct.object({ message: struct.string() }),
  events: {
    message: struct.object({ text: struct.string() }),
  },
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const command = watchUser({ id: 7 });
  const [error, stream, open] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(open.response.status);
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    if (event.event === "message") console.log(event.data.text);
  }
}

void main();
```

Request placement is the same as HTTP, including the body. Event `data` is decoded by kind: `string` stays original text, and everything else is `JSON.parse`d first and then handed to the struct. A bare literal is not JSON text. When `error` is declared, a startup failure is `Fault<TError>`; a handshake error body is likewise decoded by kind. A non-2xx whose side is undeclared or decodes successfully is `HTTP_STATUS`; a JSON media type that does not match is `RES_MEDIA_TYPE_INVALID`; a declared handshake body that fails to be read, parsed, or Struct-validated is `RES_DECODE_FAILED`, and the `cause` of a Struct failure is `StructError`, not HTTP's `RES_STRUCT_MISMATCH`. Events that are undeclared or fail validation do not enter the queue; `withSSEOnInvalidEvent` can observe them. Reconnection requires an explicit `withSSEReconnect`.

## WebSocket

`incoming` and `outgoing` are each one struct. Multiple message kinds use `struct.discriminatedUnion`. There is no message map, no type envelope, and no `normalizeIncoming` / `normalizeOutgoing`.

```ts
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
} from "@defjs/core";

const room = defineWebSocket({
  path: "/chat/:roomId",
  maxIncomingQueueSize: 100,
  protocols: ["chat.v1"],
  input: struct.object({ roomId: struct.string() }),
  builder: (input) => ({ path: input }),
  incoming: struct.object({
    type: struct.literal("message"),
    text: struct.string(),
  }),
  outgoing: struct.object({
    type: struct.literal("send"),
    text: struct.string(),
  }),
});

const client = createClient(withEndpoint("https://chat.example.com"));

async function main() {
  const command = room({ roomId: "1" });
  const [error, session] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  await using ownedSession = session;
  ownedSession.send({ type: "send", text: "Hello" });
}

void main();
```

Inbound text, `ArrayBuffer`, TypedArray, and `Blob` are read as UTF-8, then `JSON.parse`d, then handed to `incoming`. Bad JSON and struct failures go to `session.onRuntimeError`; that frame is not enqueued, and the session continues. Frames that are not text, bytes, or a Blob are dropped directly, with no notification. There is no `withWebSocketOnInvalidEvent`.

`session.send` validates and serializes synchronously: struct encoding, then `JSON.stringify`. Query rules are the same as HTTP; a complex query is no longer JSON-encoded on its own. Static `protocols` are written on the definition; the `execute` options and `withWebSocketProtocols` can still override them, and the priority is execution options, client, then definition. The selected list is copied before the logical session starts and reused on reconnect; the builder, `beforeConnect`, and interceptors cannot change subprotocols. When a token-in-subprotocol is needed, obtain the token first, then pass it through that `execute` call's `protocols` option.

## interceptor

Authentication, tracing, and changing headers across requests belong in an interceptor. `builder` only places the current input. Low-cardinality identity uses `operation` on the definition. The `queryParams` an interceptor sees is `new URLSearchParams(queryString)`; a `URLSearchParams` handed over by the builder is that same instance.

## Not currently provided

1. `struct.empty()`
2. `executeRaw(...)`
3. global client
4. `responseType`, `struct.request`, `struct.json`, `struct.text`
5. WebSocket custom handshake headers
6. OpenAPI generation
