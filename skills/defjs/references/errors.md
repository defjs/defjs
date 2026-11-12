# Error handling [#error-handling]

In Defjs, request, transport, and decoding failures do not throw exceptions at the call site. Every operation returns an error-first tuple (`[error, ...]`) where `error` is either `null` or a typed `Fault` (a native `Error` instance discriminated by `error.code`).

A call that TypeScript rejects is the exception: it has no specified result and is not a `Fault`. In practice it typically rejects with the platform's `TypeError`.

## 1. Declare service errors in the SDK, triage in the application [#1-declare-service-errors-in-the-sdk-triage-in-the-application]

<Tabs items={["Exhaustive code switch", "Basic status check", "Tuple shapes by transport"]}>
<Tab>

```typescript
import { createNetworkFault, ERR_ABORTED, type AnyFault } from "@defjs/core";

function triage(fault: AnyFault): string {
  switch (fault.code) {
    case "HTTP_STATUS":
      return `status ${fault.status}`;
    case "RES_MEDIA_TYPE_INVALID":
    case "RES_DECODE_FAILED":
    case "RES_STRUCT_MISMATCH":
      return "the contract did not hold";
    case "NET_ABORTED":
      return "the caller canceled";
    case "NET_TIMEOUT":
      return "the deadline expired";
    case "NET_UNREACHABLE":
      return "no response arrived";
    case "NET_BODY_INCOMPLETE":
      return "the response was cut short";
    case "REQ_INPUT_INVALID":
    case "REQ_BUILD_FAILED":
      return "fix the call";
    case "EXT_INTERCEPTOR_FAILED":
    case "EXT_HOOK_FAILED":
    case "EXT_OBSERVER_FAILED":
      return "fix the code you attached";
    case "CAP_BUFFER_EXCEEDED":
      return "raise the declared limit";
    case "ENV_UNSUPPORTED":
      return "the host runtime is missing something";
  }
}

const example: AnyFault = createNetworkFault(ERR_ABORTED);
console.log(triage(example));
```

</Tab>
<Tab>

```typescript
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

async function main() {
  const [error, order, response] = await getOrder(client, { id: 7 });
  if (error?.code === "HTTP_STATUS" && error.status === 404) {
    console.log(error.data.message);
    return;
  }
  if (error?.code === "NET_TIMEOUT") {
    console.log("timed out");
    return;
  }
  if (error?.code === "RES_STRUCT_MISMATCH") {
    console.log(
      "the response did not match what we declared",
      error.response.status,
    );
    return;
  }
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

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [
      error: null,
      result: TData,
      response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>,
    ]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined];

type StreamAwaitResult<
  TEvent,
  TError extends AnyStruct | undefined = undefined,
> =
  | [error: null, stream: EventStreamHandle<TEvent>, open: EventStreamOpenInfo]
  | [
      error: Fault<TError> | HttpStatusFaultOf<undefined>,
      stream: undefined,
      open: EventStreamOpenInfo | undefined,
    ];

type SocketAwaitResult<TIncoming, TOutgoing = never> =
  | [
      error: null,
      socket: WebSocketSession<TIncoming, TOutgoing>,
      connection: WebSocketConnectionInfo,
    ]
  | [
      error: Fault<undefined>,
      socket: undefined,
      connection: WebSocketConnectionInfo | undefined,
    ];
```

</Tab>
</Tabs>

### Why `error` carries the response metadata on HTTP failure [#why-error-carries-the-response-metadata-on-http-failure]

On an HTTP failure, the tuple is `[error, undefined, undefined]`. Whatever response metadata arrived (`status`, `statusText`, `headers`, `url`) is attached directly to `error.response` so you can pass `error` alone to a logger or error handler without losing context.

## 2. Fault classes and closed code set [#2-fault-classes-and-closed-code-set]

The prefix before the first `_` names the fault class (`HTTP`, `REQ`, `NET`, `RES`, `EXT`, `CAP`, `ENV`), while the full `code` forms a closed union for exhaustive `switch` statements:

| Class  | Fault codes                                                            | Meaning & remediation                                                                                                                                                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTP` | `HTTP_STATUS`                                                          | Server answered with a non-`2xx` status (`3xx`, `4xx`, `5xx`); any declared `error` struct decoded.                                                                                                                                                                                                              |
| `REQ`  | `REQ_INPUT_INVALID`, `REQ_BUILD_FAILED`                                | Caller input failed validation, the URL/path was invalid, `builder` threw, or the request could not be constructed (HTTP: body stream already used, invalid or forbidden method, GET/HEAD body, invalid `Content-Type`; HTTP and SSE: a URL with credentials, a header value the platform rejects). Never retry. |
| `RES`  | `RES_MEDIA_TYPE_INVALID`, `RES_DECODE_FAILED`, `RES_STRUCT_MISMATCH`   | Server response broke the declared media type, representation, or `struct` contract.                                                                                                                                                                                                                             |
| `NET`  | `NET_ABORTED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `NET_BODY_INCOMPLETE` | Caller canceled (`NET_ABORTED`), deadline expired (`NET_TIMEOUT`), connection failed, or stream truncated.                                                                                                                                                                                                       |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`     | An application interceptor, hook, or progress/state observer threw its own error, or an interceptor passed `next()` a `signal` that is not an `AbortSignal`.                                                                                                                                                     |
| `CAP`  | `CAP_BUFFER_EXCEEDED`                                                  | SSE frame buffer exceeded its configured bound.                                                                                                                                                                                                                                                                  |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | Host runtime lacks required Web APIs (e.g., streaming request body in Firefox).                                                                                                                                                                                                                                  |

The code names what failed, not who supplied the value. For HTTP, a request the platform cannot build is `REQ_BUILD_FAILED` whether the bad value came from the `builder`, the client configuration, or an interceptor. SSE applies the same rule to header values, an invalid URL, and a URL with credentials, on the first attempt and on every reconnect. The library checks that last one itself because Bun accepts such a URL and would send the request. Other values the platform may refuse are not checked by the library on SSE and WebSocket (an invalid method on SSE; a URL with credentials, an invalid subprotocol, or an unsupported scheme on WebSocket), so a refusal there is reported as `NET_UNREACHABLE` with the platform's error as `cause`, and a runtime that accepts the value (Bun, for an invalid SSE method) sends the request. `EXT_INTERCEPTOR_FAILED` covers the interceptor's own behavior: an error it throws, or a `signal` that is not an `AbortSignal` (the cancellation channel, not request content).

### Fault properties by code [#fault-properties-by-code]

| Fault code    | `status` | `response`                                      | `data`                                 | `cause`                           |
| ------------- | -------- | ----------------------------------------------- | -------------------------------------- | --------------------------------- |
| `HTTP_STATUS` | `number` | `DecodedResponse<TErr>` or `HttpMeta`           | Decoded `error` struct, or `undefined` | Underlying cause if any           |
| `RES_*`       | `number` | `HttpMeta` (**no `body` field**)                | Absent                                 | `StructError` or parser error     |
| Other codes   | Absent   | `HttpMeta` if headers arrived, else `undefined` | Absent                                 | Underlying `Error` / abort reason |

## 3. Narrowing union error bodies (`error.data`) [#3-narrowing-union-error-bodies-errordata]

Because one `error` struct covers all non-`2xx` statuses, declare a union when different error statuses return different JSON shapes:

<Tabs items={["Discriminate by kind", "Discriminate by body status", "Plain union (struct.or)"]}>
<Tab>

```typescript
import { struct, type Fault } from "@defjs/core";

const ApiError = struct.discriminatedUnion("kind", [
  struct.object({
    kind: struct.literal("validation"),
    fields: struct.array(struct.string()),
  }),
  struct.object({
    kind: struct.literal("rateLimit"),
    retryAfter: struct.number(),
  }),
]);

declare const fault: Fault<typeof ApiError>;

if (fault.code === "HTTP_STATUS") {
  switch (fault.data.kind) {
    case "validation":
      console.log(fault.data.fields.length);
      break;
    case "rateLimit":
      console.log(fault.data.retryAfter);
      break;
  }
}
```

</Tab>
<Tab>

```typescript
import { struct, type Fault } from "@defjs/core";

const ApiError = struct.discriminatedUnion("status", [
  struct.object({ status: struct.literal(404), resource: struct.string() }),
  struct.object({ status: struct.literal(429), retryAfter: struct.number() }),
]);

declare const fault: Fault<typeof ApiError>;

if (fault.code === "HTTP_STATUS" && fault.data.status === 429) {
  console.log(fault.data.retryAfter);
}
```

</Tab>
<Tab>

```typescript
import { struct, type Fault } from "@defjs/core";

const ApiError = struct.or(
  struct.object({ message: struct.string() }),
  struct.object({ retryAfter: struct.number() }),
);

declare const fault: Fault<typeof ApiError>;

if (fault.code === "HTTP_STATUS" && "retryAfter" in fault.data) {
  console.log(fault.data.retryAfter);
}
```

</Tab>
</Tabs>

Prefer `struct.discriminatedUnion(...)` whenever the API includes a literal tag (`kind`, `type`, or an embedded `status` field).

## 4. Startup vs. post-open errors for SSE and WebSocket [#4-startup-vs-post-open-errors-for-sse-and-websocket]

For long-lived connections, the operation tuple reports **startup** failures (before the stream or socket opens). Once opened, runtime failures are delivered through the handle or session lifecycle:

| Transport     | Startup failure (returned in tuple)                                                                                                                                       | Post-open failure (after tuple resolves)                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP**      | All failures settle the operation tuple once.                                                                                                                             | N/A                                                                                                                                                                                                                                         |
| **SSE**       | Non-`2xx` (`HTTP_STATUS`, or the decode fault when the declared `error` body cannot be decoded), or a `2xx` handshake with a bad content type (`RES_MEDIA_TYPE_INVALID`). | Async iterator rejects; `stream.closed` resolves with `{ kind: 'error', code }`.                                                                                                                                                            |
| **WebSocket** | Pre-open close, constructor failure, or abort during handshake.                                                                                                           | Non-fatal frame errors fire `session.onRuntimeError`; fatal errors reject `session.receive` and resolve `session.closed` with `{ kind: 'error', cause }`. A heartbeat timeout and exhausted retries retain ordinary runtime `Error` causes. |

## 5. Safe structured logging and cause inspection [#5-safe-structured-logging-and-cause-inspection]

Every `Fault` is a native `Error` (`instanceof Error === true`) with enumerable `code`, `status`, `response`, and `data` properties.

<Tabs items={["Inspect StructError cause", "Redacted diagnostic summary"]}>
<Tab>

```typescript
import { StructError, type AnyFault } from "@defjs/core";

export function logFault(fault: AnyFault): void {
  console.error(String(fault), { code: fault.code });
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify());
  }
}
```

</Tab>
<Tab>

```typescript
import type { AnyFault } from "@defjs/core";

export function summarize(fault: AnyFault): {
  code: AnyFault["code"];
  status?: number;
} {
  return {
    code: fault.code,
    status: "status" in fault ? fault.status : undefined,
  };
}
```

</Tab>
</Tabs>

> [!CAUTION]
> Treat `fault.cause`, `fault.data`, response headers, full URLs, and `StructIssue.received` as potentially sensitive. Log an allowlist of low-cardinality fields (`operation`, `code`, `status`, duration) by default.

## Related reading [#related-reading]

- [Handle a declared 404](/recipes/get-declared-404)
- [Cancel an HTTP call](/recipes/cancel-http)
- [Core architecture](/docs/design-decisions)
