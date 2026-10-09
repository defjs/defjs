---
title: HTTP
description: Define a request, execute it, branch on status, and cancel with signal or timeout.
---

# HTTP

Define → execute → branch on the tuple → cancel when the screen goes away. That’s the whole HTTP loop.

## Basic Setup

```typescript twoslash
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

const [error, data, response] = await client.execute(getUser({ id: 7 }))
if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (!error) {
  console.log(data.name, response.status)
}
```

## Resolve the URL

`withEndpoint(...)` needs a valid absolute URL. Endpoint pathname stays as a directory; query and hash are discarded before command resolution.

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({ path: { id: input.id }, query: { fields: input.fields } }),
})

const command = getUser({ id: 'a/b', fields: 'name' })
void client.execute(command)
// → https://api.example.com/v1/users/a%2Fb?fields=name
```

Path placeholders are raw scalars, encoded exactly once. Empty values and `.` / `..` are rejected. Slashes, `?`, `#`, `%`, spaces, and Unicode in one placeholder stay one encoded segment — don’t pre-encode.

Definition path can’t contain `?` or `#`, and can’t be absolute or protocol-relative. The default query encoder accepts scalars and arrays of scalars (arrays repeat the key). A nested object fails with `REQ_BUILD_FAILED` unless the client has `withQuerySerializer(...)`. `null` in `path`, `query`, or `headers` fails the same way. `undefined` is omitted.

## Place the input

The struct encodes the value. The builder places it. Omit `builder` when `input` is already `{ path?, query?, headers?, body? }`.

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})

const [error, user] = await client.execute(
  updateUser({
    path: { id: 7 },
    headers: { requestId: 'request-42' },
    body: { displayName: 'Ada' },
  }),
)
if (error) console.error(error.code)
else console.log(user.id)
```

That body is `{"display_name":"Ada"}` with `application/json`. The header wire name is `x-request-id`. Callers and parsed results keep `displayName`.

Prefer handing the typed value over spelling wire keys. Alias is declared once on the field and applies in both directions: `output` / `error` / events / incoming frames decode `display_name` to `displayName`, and `body: input.order` rewrites the whole tree. The same `User` struct can be a create body and a get output. A hand-written key is the exception: the parent object is anonymous, so the alias does not run.

| Builder expression                              | On the wire                                        |
| ----------------------------------------------- | -------------------------------------------------- |
| `body: input.profile`                           | Typed object: alias and `Date` / `bigint` encoding |
| `body: { profile: input.profile }`              | Outer keys literal, inner object still typed       |
| `body: { ...input.profile, role: 'admin' }`     | Spread keeps the struct; the extra key is literal  |
| `body: { name: input.profile.displayName }`     | Anonymous parent: alias does not apply             |
| `query: input.query` / `headers: input.headers` | Typed flat objects: alias becomes the wire key     |

Spreading a typed object and also setting its wire key (`display_name` next to `displayName`) is `REQ_BUILD_FAILED`. A nested object in `path` or `headers` fails the same way.

The guide is chosen at every node, not only at the root. A new object under an anonymous parent keeps the keys you wrote. The same object under a typed parent uses that field's struct.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

When a union guide matches more than one branch, each branch is encoded and compared. Identical wire output is kept; a difference is `REQ_BUILD_FAILED`.

A mixed intersection that contains a non-object part is tagged, when parsed, with the conjunction of the tags from the parts that matched; a newly written mixed-intersection value that was not parsed is an anonymous object.

### Query

Nested query shape (`a[b]`, `a.b`, comma lists) is a backend convention, so the hook is on the client:

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

`query` here is the encoded wire object. Aliases are already applied, so a serializer such as `qs` does not drop them. The return string is the query string. Defjs does not depend on `qs`.

Without a serializer, arrays repeat keys and a nested object is `REQ_BUILD_FAILED`. Returning `URLSearchParams` from the builder uses that value as-is and skips the serializer. The serializer is not called when there is no query. Interceptors then see `queryParams` as `new URLSearchParams(queryString)`.

### Body

The first match wins:

| `body` value                                                   | Sent as                                                                 | Default content type                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| omitted / `undefined`                                          | no body                                                                 | —                                                       |
| typed object whose root has a `urlencoded` or `formData` codec | `URLSearchParams` / `FormData`; keys are wire names; arrays repeat keys | form type / platform boundary                           |
| `FormData`, `URLSearchParams`                                  | as-is                                                                   | same; Defjs clears a stale `Content-Type` on `FormData` |
| `Blob` / `File`                                                | as-is                                                                   | `blob.type`, or `application/octet-stream`              |
| `ArrayBuffer`, `TypedArray`, `DataView`                        | as-is                                                                   | `application/octet-stream`                              |
| `ReadableStream`                                               | streamed (`duplex: 'half'` when the runtime allows it)                  | `application/octet-stream`                              |
| `string`                                                       | as-is                                                                   | `text/plain;charset=UTF-8`                              |
| object, array, number, boolean, `null`                         | encoded, then `JSON.stringify`                                          | `application/json`                                      |

Set `content-type` on `headers` to override the default. The codec tag applies only at the body root: `body: { meta: input.form }` is JSON, and the form fields are ordinary JSON fields. A string is raw text; a JSON string such as `"abc"` needs `JSON.stringify` plus `application/json`. `undefined` fields are omitted; a `nullable` field sent as `null` is JSON `null`.

`GET` and `HEAD` cannot return a body — that is a type error. WebSocket builders cannot return `headers` or `body`.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const login = defineRequest({
  method: 'POST',
  path: '/login',
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias('username'),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
})

const upload = defineRequest({
  method: 'POST',
  path: '/files/:id',
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData()
    input.photos.forEach((photo, index) => body.append('photo', photo, `photo-${index}.jpg`))
    return { path: { id: input.id }, body }
  },
})

void login
void upload
```

`JSON.stringify`, `qs`, or protobuf that you run yourself sees logical names. Alias does not apply on that path. There is no public `struct.encode`.

A builder may branch on the real input and return a different body per case (JSON records, a `File`, or `URLSearchParams`). Native `Headers` are also passed through and are not re-encoded.

## How a body is read

`output` is one Struct for the 2xx body; `error` is one Struct for everything else. The struct kind
selects the representation: `string` is raw text, `blob` / `file` are blobs, `arrayBuffer` is bytes,
and every other kind is JSON. With neither side declared, the body is never read.

Order of operations:

1. `ok` picks the side: `output` for 2xx, `error` for everything else. Never both.
2. Nothing declared for that side → the body is never read. 2xx succeeds with `data === undefined`;
   non-2xx is `HTTP_STATUS` with `data === undefined`. An unreadable body on a side you did not
   declare is ignored, including the fact that it could not be read.
3. The media type is checked **before** the body is read. A mismatch is `RES_MEDIA_TYPE_INVALID` and
   nothing is parsed or decoded.
4. The representation is read. A failure is `RES_DECODE_FAILED`. JSON from the transport is parsed once:
   a string on that value is a JSON string root and is not parsed again; bytes and blobs are raw and
   are parsed once.
5. The Struct parses the value. A failure is `RES_STRUCT_MISMATCH`.
6. 2xx → result and a typed `response.body`; non-2xx → typed `data` on `HTTP_STATUS`.

Decoding happens once, after the interceptor chain, so a response an interceptor built with
`makeResponse(...)` is read exactly like one off the wire. On a JSON representation, a string body is a
JSON string root.

A successful response is a `DecodedResponse<T>`: `url`, `status`, `statusText`, `headers`, `ok`, and
a typed `body`. Where nothing was decoded you get `HttpMeta` — the same fields without `body`. `ok`
means only `200 <= status < 300`. Neither is a native `Response`. A transport failure is a fault, so
there is no status-0 response standing in for one.

## Cancel the work {#cancel-the-work}

Execution options take `signal` plus either `abort` or `timeout`. **`abort` and `timeout` are mutually exclusive.** `signal` can combine with either.

```ts
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const command = defineRequest({ method: 'GET', path: '/report' })()
const controller = new AbortController()
const pending = client.execute(command, { signal: controller.signal, timeout: 5_000 })

controller.abort('screen closed')
const [error] = await pending
if (error?.code === 'NET_ABORTED') {
  console.log('caller cancellation')
}
```

`timeout` must be a positive safe integer in `1..2_147_483_647`. Recognized cancel → `NET_ABORTED`; execution timeout → `NET_TIMEOUT`; interceptor `throw` → `EXT_INTERCEPTOR_FAILED`; other Fetch failures → `NET_UNREACHABLE`. Cancel after the server accepted a write does **not** prove the write rolled back.

## Credentials and XSRF

`withCredentials(true)` sets Fetch `credentials: 'include'` for HTTP and SSE. It does not create `Authorization` and does not configure WebSocket auth. `false` leaves credentials unspecified.

`withXSRF(...)` is HTTP-only. Defaults: `cookieName: 'XSRF-TOKEN'`, `headerName: 'X-XSRF-TOKEN'`. Header injects only for non-safe methods, only when the caller didn’t already set it, and only for same-origin browser requests. Skips `GET`, `HEAD`, `OPTIONS`, `TRACE`. Outside a browser, pass a synchronous request-scoped `tokenProvider` if you need injection.

Keep credentials, XSRF tokens, and query strings out of routine logs. Don’t use query params as a general credential channel.

## Progress and the Fetch boundary

`onDownloadProgress` runs while a declared response body is read. `lengthComputable` is true only with a positive `Content-Length`. No struct for that side → the body is not read → no body-read progress.

`onUploadProgress` watches a `ReadableStream<Uint8Array>` request body as Fetch reads it. A JSON or text body is not that stream — return `file.stream()` (or another `ReadableStream`) from the builder when you need upload progress. The transport reports a capability error when the runtime cannot send a streamed body.

`fetchHandler(httpRequest, fetchImpl?)` is the lower-level Fetch boundary: builds a native `Request`, calls Fetch, reads the representation, returns `HttpResponse`. It does **not** validate command input, dispatch `output`, or run interceptors. Useful for injected transport tests — not a substitute for `client.execute`.

## Replay limits

Defjs does **not** auto-retry HTTP. Retrying a read still needs a reviewed timeout/network/duplicate policy. Retrying a mutation needs replayable bytes, server support, an idempotency key bound to auth scope + request bytes, and a receiver duplicate policy.

A client/command/Fetch boundary can’t know if a failed write committed. Keep replay decisions in the app or a reviewed interceptor. Interceptors can short-circuit or replace the low-level request; the final status and body must still satisfy the command’s contract.

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
- [Test with a local Fetch handle](../recipes/test-with-handle.md)
