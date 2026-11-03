# `@defjs/core` Usage Manual

> The structural contract is defined by `src/struct/README.md` and `src/struct/public_api.ts`. Which segment a request goes into is decided by the endpoint's `builder`; encoding is driven by the typed values handed over. `struct` only exposes structural declarations and `.alias(name)`; there is no public `struct.encode`.

This document keeps only the APIs that are currently used most often. Site documentation is in the repository `doc/`.

Defjs's purpose is to make SDKs easier to design, write, and deliver. `def` stands for `define`: the SDK author defines the API contract and exports endpoints; the application creates its own Client and decides the service address, authentication, transport configuration, and call lifecycle. A definition can be published as a standalone npm package and is not bound to any application's Client; both sides still follow Defjs's execution contract and compatible version requirements.

Full reading path: first see the separated definition module and calling application in `doc/content/zh-Hans/docs/start.mdx`, then see the packaging and publishing approach in `doc/content/zh-Hans/recipes/publish-http-sdk.mdx`. The rest of this document is looked up by API category.

## Quick start

### Create a client

```ts
import { createClient, withEndpoint } from "@defjs/core";

const client = createClient(
  withEndpoint(
    "https://api-us.example.com/v1",
    "https://api-eu.example.com/v1",
  ),
);
```

`endpoints` is a `readonly string[]` of candidate base URLs. `withEndpoint` copies the arguments and keeps the first occurrence of each string. It does not check that a string is a URL, and it does not replace the balancer. A later `withEndpoint` replaces the list. The default is `[]`. An empty array is a legal value and fails the call with `REQ_BUILD_FAILED`.

One candidate is chosen when the operation runs, after the input parses and the cancellation check has passed, and before the builder runs. Importing a definition does not choose, and `createClient` does not choose. The chosen string is that call's base address. It is parsed with `new URL` first, then the `path` from the definition is joined. The pathname is treated as a directory; query and hash on the base address are dropped.

For example, when `https://api.example.com/v1` is the candidate that was chosen:

```ts
endpoint = "https://api.example.com/v1";
path = "/orders/info";
```

The final request URL is:

```ts
https://api.example.com/v1/orders/info
```

### Choosing an endpoint

Each client has its own balancer. The default `pickFirstBalancer()` stays on the first candidate until an attributed `NET_UNREACHABLE` or an uncoded 502/503/504 response advances it, wrapping at the end. Coded failures ignore their status, so `NET_BODY_INCOMPLETE` with 503 does not advance. Other responses, timeouts, and unattributed outcomes keep the sticky endpoint. `withEndpointBalancer` preserves balancer identity. `roundRobinBalancer()` starts at a random index and supports finite positive weights, with 1 for missing candidates.

Round robin and `p2cBalancer` enable `outlierDetection` by default; `false` disables it and an object captures its fields with defaults. Pick-first remains unfiltered by default and enables filtering with an object. Only unfiltered round robin omits `done`. The exported `outlierDetection(child, options)` is the same wrapper used by the factories. Invalid options are persistent branded errors; invalid synchronous `isHealthy` results reject only that pick.

Health samples require `attempted: true`. Default failures are `NET_UNREACHABLE` or 5xx, excluding coded timeouts and incomplete bodies regardless of status. Invalid `isFailure` results discard samples while forwarding callbacks. Nonfailures reset consecutive streaks; unattributed outcomes do not. Five consecutive failures break an endpoint by default (Finagle); zero disables passive breaking.

Penalties follow Linkerd: `base = min(minPenaltyMs * 2^level, maxPenaltyMs)`, plus uniform positive jitter up to `base * jitterRatio`, capped at maximum. Defaults are 1000 ms, 60000 ms, and 0.5; level starts at zero. Expiry admits one probe, selected by the child strategy. `end` decides it at headers or socket open: nonfailure restores availability and resets level, failure increments level and breaks immediately. Without end, done decides; unattributed completion only releases the slot. An invalid terminal classifier discards the sample and releases its slot. After a probe decision, late done is an ordinary sample; other samples while broken/probing do not change counters. Time is checked lazily with Date.now in picks and callbacks. There is no probe timeout, slow start, settlement grid, percentage criterion, quota, or last-host protection. Every endpoint may break, with Finagle-style list-local fail-open. These rules differ from Envoy/gRPC A50 ejection quotas. `failbackMs` remains independent.

Active `isHealthy` is application-owned cached state, called once per current candidate only on pick. True cannot cancel passive ejection. If no candidates remain, ignore active checks first, then passive ejections, using only the current list. Unchanged lists retain array identity and pick metadata is forwarded. No background health timer exists. The application owns probe cancellation and cleanup.

p2c samples min(choiceCount, candidates) without replacement, unlike Envoy/gRPC A48; ties favor the first draw. Choice count defaults to 2, is an integer at least 2, and caps at 10. tower PeakEwma load is decaying RTT × (pending + 1); pending-only mode compares in-flight attempts. Linkerd defaults are RTT 30 ms and decay 10000 ms, both finite positive. Idle RTT decays toward zero for exploration. Only start increments pending; end releases it and samples max(0, Date.now() - startTime) for all transports, irrespective of success. Larger samples immediately replace RTT; otherwise d = exp(-Δt/decayMs), RTT = old*d + sample*(1-d). Done without end releases pending without sampling. Unstarted attempts do not affect pending. There is no failure penalty or p2c isFailure option. Health breaking handles quick failures. Once state exceeds 256 entries, absent zero-pending entries are removed; outstanding attempts retain state.

HTTP defaults to one additional same-call attempt for connection failures on GET, HEAD, OPTIONS, and TRACE. `withEndpointFailover` replaces the policy, not merges it: omitted `attempts`, `retryOn`, and `methods` use 1, `["connect-failure"]`, and those four methods. Matching is case-insensitive. `attempts: 0` or `methods: []` disables failover. A `ReadableStream` request body never fails over. Explicit `gateway-error` permits 502/503/504 failover and releases the discarded response body, including when that response fails declared error-body decoding with a `RES_*` fault. Interceptor success and `EXT_*` failures never trigger gateway failover. Explicit `attempt-timeout` permits failover after `attemptTimeoutMs` (finite and positive), measured from Fetch invocation through body reading and decoding. Each additional attempt excludes already-tried endpoints and reruns pick, builder, the complete interceptor chain, and transport. The caller signal covers the entire call; cancellation or its deadline never starts another attempt. The final attempt's tuple is returned. Invalid failover options return `REQ_OPTIONS_INVALID` at execution.

`pickFirstBalancer({ failbackMs })` accepts a finite positive interval. After leaving the first candidate, the first eligible pick probes it at that interval; concurrent picks keep using the sticky fallback. A probe that does not meet the advance conditions restores the first candidate; a failed probe preserves the fallback and restarts the interval. `attempted: false` only releases the probe slot. No timer is created; shuffled order defines first when `shuffle` is enabled.

An attributed `NET_UNREACHABLE` becomes `{ attempted: false }` when `navigator.onLine === false`, and HTTP does not fail over offline. Only strict false counts; missing or throwing navigator access is treated as online.
`pick` must be synchronous and returns `[error, undefined]` or `[null, { endpoint, start?, end?, done? }]`. An error tuple, a throw, or any other return becomes `REQ_BUILD_FAILED` on the operation tuple. The `cause` is that error, thrown value, or return value. The call does not throw, and `done` is not called. An empty candidate list uses `ERR_NO_ENDPOINT` as that cause. `isNoEndpointCause` recognizes the sentinel from another Core copy. It is not a `FaultCode`. A built-in factory never throws. An invalid option is saved at construction, and every later `pick` returns it. The call then reports `REQ_OPTIONS_INVALID`.

`start`, when supplied, is called synchronously at most once immediately before HTTP/SSE Fetch or WebSocket construction, with the same attribution as `done`. A pre-transport failure, short-circuit, replaced base, or cancellation does not call it. The runtime snapshots and validates it once, and its wrapper owns the once-only rule. `start` throws and thenable rejections are contained like `done`. Health filtering forwards it unchanged.

`done`, when the result includes it, is called once, synchronously, with the outcome below. `done` must be synchronous. A promise returned by `pick` or `done` is not awaited and its rejection is ignored; a promise from `pick` remains an invalid return and becomes `REQ_BUILD_FAILED`. A throw from `done` is ignored and does not replace the operation tuple. HTTP uses one choice for each failover attempt, including when an interceptor calls `next` again within that attempt. SSE and WebSocket choose again on each reconnect of the stream or socket that is still attributed: for SSE, only the stream opened by the first `next`; once an interceptor replaces the base, reconnects no longer choose. A call that was already cancelled before a choice does not call `pick` or `done`.

| What happened                                                                                                                                                                                                                             | Reported outcome                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The attempt never reached the chosen base: building failed, the URL was rejected, the platform cannot perform the call, an interceptor did not continue, the base was replaced, or the call timed out or was cancelled before the attempt | `{ attempted: false }`                                                                     |
| The peer answered, including a later decode or media-type failure                                                                                                                                                                         | `{ attempted: true, status }`                                                              |
| Reading the body stopped early                                                                                                                                                                                                            | `{ attempted: true, code: "NET_BODY_INCOMPLETE", status }`                                 |
| The connection failed, and the failure is not a timeout or a cancellation                                                                                                                                                                 | `{ attempted: true, code: "NET_UNREACHABLE" }`                                             |
| The attempt had started and the call's fault is `NET_TIMEOUT`                                                                                                                                                                             | `{ attempted: true, code: "NET_TIMEOUT" }`, with no `status`, even if one was already seen |
| The attempt had started and the fault is `NET_ABORTED`, or the caller closed the stream or socket                                                                                                                                         | `{ attempted: false }`                                                                     |
| A WebSocket opened and then closed normally                                                                                                                                                                                               | `{ attempted: true }`                                                                      |

`end` shares EndpointDoneInfo with done, without durationMs. It runs synchronously once after start at HTTP/SSE Fetch response headers or WebSocket open, or on failure/cancellation before that point. Headers report attempted true and status; socket open reports attempted true. Pre-response errors use the existing timeout/abort mapping (handshake timeout is NET_UNREACHABLE, caller timeout NET_TIMEOUT, cancellation unattributed). No start means no end. The runtime snapshots/validates end once, contains throws and thenable rejections, and guarantees at most once. Health forwards end and classifies probes before forwarding. This is tower CompleteOnResponse with Linkerd's separate health signal: Fetch cannot expose Linkerd's first-data-frame completion or Envoy's stream boundary. Body and post-interceptor work affect done but not an already-emitted end.

HTTP failover shares one Finagle-style token budget per client configuration, including derived values. Defaults are percentCanRetry 0.2, minRetriesPerSecond 10, ttlMs 10000; retryBudget false disables it. Each original HTTP call deposits 1000 tokens, each additional attempt withdraws min(2147483647, floor(1000 / percent)), with a constant reserve minimum * floor(ttlMs / 1000) * withdrawal; like Finagle, the TTL counts whole seconds. Percent zero deposits zero and charges one. Both deposits and debits expire in ten fixed ttlMs/10 slices, at most one slice early, cleaned only on access with no timer and bounded memory. Exhaustion returns the current attempt unchanged. Percent is finite in [0, 1000], minimum a nonnegative safe integer, TTL finite in [1000, 60000]. Gateway-error is only uncoded 502/503/504, unlike Envoy's inclusion of no-response disconnects/resets. Safe-method connection failover remains enabled by default, unlike Linkerd/Envoy opt-in policies; gRPC transparent retry requires different non-processing evidence.

There is no default deadline or attempt/handshake timeout. The caller signal covers the whole call or session. SSE and WebSocket reconnect blocks optionally accept positive finite `connectTimeoutMs`, normalized before execution. SSE times Fetch to response headers; WebSocket times construction to open. Expiry aborts the physical attempt and reports `{ attempted: true, code: "NET_UNREACHABLE" }` to the balancer, allowing existing reconnect rules to pick again. Retry exhaustion returns or closes with `NET_TIMEOUT`. Every exit clears the timer; established sessions are unaffected. SSE normal EOF remains terminal: ongoing subscriptions observe `closed` and start a new call with an application cursor. Existing long-lived connections do not rebalance; a server-side maximum connection lifetime encourages a new pick.

## Client rules

`client` is created by the application and passed to an operation:

```ts
const [error, result] = await getOrder(client({ signal }), { id: 7 });
```

`defineRequest` / `defineEventStream` / `defineWebSocket` return an operation. Calling it with a client starts the call and returns an error-first tuple. `createClient` returns a `DerivableClient`, a callable that is also a `Client`. Calling it with `RequestOptions` returns a non-callable `Client` value and does not perform I/O. The factory itself is a `Client` and carries no request options. There is no `.with({ client })` and no `client.execute`.

`RequestOptions` has seven fields: `signal`, `onUploadProgress`, `onDownloadProgress`, `beforeConnect`, `protocols`, `heartbeat`, and `reconnect`. `client()` and `client(undefined)` store no request options. `client({})` keeps an empty snapshot and is not dropped by inspecting keys. `client(options)` reads each top-level field once. A `protocols` array is copied. `heartbeat` copies `intervalMs`, `isAck`, `message`, and `timeoutMs`. `reconnect` copies `attempts`, `delayMs`, `factor`, `jitter`, `maxDelayMs`, and `shouldReconnect`. Missing nested blocks stay missing and do not enable those features. `signal`, `beforeConnect`, and callbacks keep their identity. The same helpers copy those shapes when a `withWebSocketHeartbeat`, `withWebSocketReconnect`, `withWebSocketProtocols`, or `withSSEReconnect` option is applied. `withInterceptors` appends a fresh `{ kind, fn }` record and keeps `fn`. A client value is not callable, so create one per call. `signal` is not combined; reusing a client value that carries `signal` shares the signal between calls. The base configuration from `createClient` is shared by every client value and is not frozen at runtime. It is fixed by convention: nothing in the library changes it, and applications should not either. A custom client option may still hold a reference. A getter on a captured fixed field throws from `client(options)`, from applying that helper, or from `defineRequest` / `defineEventStream` / `defineWebSocket`; these configuration-call exceptions are not converted into faults. XSRF fields are captured while building each HTTP request. A getter failure there is handled by the existing request-building fault boundary, with cancellation retaining priority. `defineEventStream` copies the events dictionary container and leaves schema accessors lazy. `defineWebSocket` copies the `protocols` array. Illegal numbers, such as a reconnect policy, are still checked when the operation runs and still return `REQ_OPTIONS_INVALID`. Each protocol reads the fields it understands and ignores the rest. SSE reads only `signal` from request options. SSE reconnect comes from client configuration (`withSSEReconnect`), so `client({ reconnect })` affects WebSocket only.

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

`builder` is a synchronous pure function. It receives the parsed real values and returns `{ path?, query?, headers?, body? }`. It runs when the operation executes. A thrown error becomes `REQ_BUILD_FAILED` on the tuple; the operation returns that fault instead of throwing.

`defineRequest`, `defineEventStream`, and `defineWebSocket` must explicitly provide a `builder` whenever `input` is declared. `input` only defines the input parameters; where each value is placed is decided only by the builder, and the library does not infer placement from input field names or the path template. Only a definition with no `input` may omit `builder`.

```ts
import { defineRequest, struct } from "@defjs/core";

const OrderBody = struct.object({
  customerName: struct.string().alias("customer_name"),
});

const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    order: OrderBody,
  }),
  builder: (input) => ({ path: { id: input.id }, body: input.order }),
  output: OrderBody,
});

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: OrderBody,
});
```

The calls are `updateOrder(client, { id: 7, order: { customerName: 'Ada' } })` and `getOrder(client, { id: 7 })` respectively. Prefer handing over typed values: `body: input.order` applies aliases across the whole tree. Keys of an object you write yourself are literal wire keys, and aliases do not apply. A spread keeps the struct; a logical key and a wire key appearing at the same time is `REQ_BUILD_FAILED`.

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

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({
    id: struct.number(),
    customerName: struct.string().alias("customer_name"),
  }),
  error: struct.object({ message: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, data, response] = await getOrder(
    client({ signal: AbortSignal.timeout(10_000) }),
    { id: 7 },
  );
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(data.customerName, response.status);
}

void main();
```

`output` is one struct for 2xx; `error` is one struct for the other statuses. `ok` is the only branch, and only one side is decoded. The representation is decided by kind: `string` is original text, `blob` / `file` is a Blob, `arrayBuffer` is bytes, and everything else is JSON. There is no `responseType`.

Success is `[null, data, response]`. Failure is `[error, undefined, undefined]`, and metadata is on the fault. A non-2xx whose `error` decodes successfully is `HTTP_STATUS`; a media type that does not match is `RES_MEDIA_TYPE_INVALID` (before the body is read); a representation that cannot be read is `RES_DECODE_FAILED`; a struct that does not match is `RES_STRUCT_MISMATCH`. A transport failure is a fault, not a response with status 0.

Cancellation is the `signal` field. `AbortSignal.timeout(ms)` is classified as `NET_TIMEOUT`; aborting a signal yourself is `NET_ABORTED`. There is no client-level default timeout and no `abort` field. SSE and WebSocket no longer have a startup-only deadline: the same signal aborts the connection after it opens. To limit only startup, create an `AbortController`, pass its signal, and clear the timer after the operation resolves. An input that fails the struct is `REQ_INPUT_INVALID`.

## SSE

```ts
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const followDeployLog = defineEventStream({
  method: "GET",
  path: "/deployments/:id/log",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  error: struct.object({ message: struct.string() }),
  events: {
    line: struct.object({ text: struct.string() }),
    done: struct.object({ status: struct.string() }),
  },
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, stream, open] = await followDeployLog(client, { id: 7 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(open.response.status);
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    if (event.event === "line") console.log(event.data.text);
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

const quoteFeed = defineWebSocket({
  path: "/quotes/:market",
  maxIncomingQueueSize: 100,
  protocols: ["quotes.v1"],
  input: struct.object({ market: struct.string() }),
  builder: (input) => ({ path: input }),
  incoming: struct.object({
    type: struct.literal("tick"),
    symbol: struct.string(),
    price: struct.number(),
  }),
  outgoing: struct.object({
    type: struct.literal("subscribe"),
    symbol: struct.string(),
  }),
});

const client = createClient(withEndpoint("https://quotes.example.com"));

async function main() {
  const [error, session] = await quoteFeed(client, { market: "nasdaq" });
  if (error) {
    console.error(error.code);
    return;
  }
  await using ownedSession = session;
  ownedSession.send({ type: "subscribe", symbol: "ACME" });
}

void main();
```

Inbound text, `ArrayBuffer`, TypedArray, and `Blob` are read as UTF-8, then `JSON.parse`d, then handed to `incoming`. Bad JSON and struct failures go to `session.onRuntimeError`; that frame is not enqueued, and the session continues. Frames that are not text, bytes, or a Blob are dropped directly, with no notification. There is no `withWebSocketOnInvalidEvent`.

`session.send` validates and serializes synchronously: struct encoding, then `JSON.stringify`. Query rules are the same as HTTP; a complex query is no longer JSON-encoded on its own. Static `protocols` are written on the definition; `RequestOptions.protocols` and `withWebSocketProtocols` can still override them, and the priority is request options, client, then definition. The selected list is copied before the logical session starts and reused on reconnect; the builder, `beforeConnect`, and interceptors cannot change subprotocols. When a token-in-subprotocol is needed, obtain the token first, then pass it through that call's `protocols` option.

## interceptor

Authentication, tracing, and changing headers across requests belong in an interceptor. `builder` only places the current input. Low-cardinality identity uses `operation` on the definition. The `queryParams` an interceptor sees is `new URLSearchParams(queryString)`; a `URLSearchParams` handed over by the builder is that same instance.

## Not currently provided

1. `struct.empty()`
2. `executeRaw(...)`
3. global client
4. `responseType`, `struct.request`, `struct.json`, `struct.text`
5. WebSocket custom handshake headers
6. OpenAPI generation
