# Error-first tuples and `Fault` handling

Contents: [Tuple shapes](#tuple-shapes) · [Fault variants and codes](#fault-variants-and-codes) · [Narrowing declared HTTP errors](#narrowing-declared-http-errors) · [Triaging and logging faults](#triaging-and-logging-faults)

## Tuple shapes

Operations never throw for request, response, validation, or transport failures. They resolve to an error-first tuple:

| Protocol                      | Success tuple                        | Failure tuple                                                   |
| ----------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| HTTP (`defineRequest`)        | `[null, data, response]`             | `[Fault<TError>, undefined, undefined]`                         |
| SSE (`defineEventStream`)     | `[null, stream, startupOpen]`        | `[Fault<TError>, undefined, startupOpen \| undefined]`          |
| WebSocket (`defineWebSocket`) | `[null, session, startupConnection]` | `[Fault<undefined>, undefined, startupConnection \| undefined]` |

Always check `if (error)` and return from the surrounding function before reading the second or third element.

## Fault variants and codes

`Fault<TError>` (and `AnyFault`) is a discriminated union keyed by `error.code`. Every fault carries `code`, `message`, and optional `cause`; `FaultClass<FaultCode>` extracts the code prefix for coarse classification. Variant-specific fields (`status`, `data`, `response`) become available when you narrow `error.code`:

| `error.code`             | Fault variant             | Extra fields                                  | When it happens                                                                                                         |
| ------------------------ | ------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `REQ_INPUT_INVALID`      | `PreflightFault`          | `cause` (`StructError`)                       | Caller input failed the `input` struct                                                                                  |
| `REQ_BUILD_FAILED`       | `PreflightFault`          | `cause`                                       | `builder` threw, or returned an invalid path/query/header/body placement                                                |
| `REQ_OPTIONS_INVALID`    | `PreflightFault`          | `cause`                                       | Invalid retry, reconnect, heartbeat, buffer, or queue option, including timeouts above 2147483647 ms                    |
| `NET_UNREACHABLE`        | `PreflightFault`          | `cause`                                       | DNS, socket, TLS, or CORS failure before receiving a valid response                                                     |
| `NET_BODY_INCOMPLETE`    | `PreflightFault`          | `response?`, `cause`                          | Response body stream broke mid-transfer                                                                                 |
| `NET_TIMEOUT`            | `PreflightFault`          | `cause`                                       | `AbortSignal.timeout(ms)` or a `TimeoutError` DOMException aborted the call                                             |
| `NET_ABORTED`            | `PreflightFault`          | `cause`                                       | Caller aborted the `AbortSignal`                                                                                        |
| `HTTP_STATUS`            | `HttpStatusFault<TError>` | `status`, `data`, `response`                  | Non-2xx response whose declared `error` struct decoded (or no `error` struct was declared)                              |
| `RES_MEDIA_TYPE_INVALID` | `DecodeFault`             | `status`, `response`, `cause`                 | `Content-Type` does not match the declared representation (JSON body or SSE handshake), checked before reading the body |
| `RES_DECODE_FAILED`      | `DecodeFault`             | `status`, `response`, `cause`                 | Response body could not be read or JSON-parsed (or SSE handshake error struct failed)                                   |
| `RES_STRUCT_MISMATCH`    | `DecodeFault`             | `status`, `response`, `cause` (`StructError`) | HTTP response body did not match the declared `output` or `error` struct                                                |
| `EXT_INTERCEPTOR_FAILED` | `PreflightFault`          | `cause`                                       | An interceptor threw or returned an invalid response/handle                                                             |
| `EXT_HOOK_FAILED`        | `PreflightFault`          | `cause`                                       | `beforeConnect` or another lifecycle hook threw                                                                         |
| `EXT_OBSERVER_FAILED`    | `PreflightFault`          | `cause`                                       | `onUploadProgress` or `onDownloadProgress` threw                                                                        |
| `CAP_BUFFER_EXCEEDED`    | `PreflightFault`          | —                                             | SSE frame buffer before a blank line exceeded `maxBufferSize`                                                           |
| `CAP_QUEUE_OVERFLOW`     | `PreflightFault`          | —                                             | SSE `maxQueueSize` or WebSocket `maxIncomingQueueSize` overflowed                                                       |
| `ENV_UNSUPPORTED`        | `PreflightFault`          | —                                             | Default `fetch` or `WebSocket` is missing, or the runtime cannot send a `ReadableStream` request body                   |

`withSSEOnInvalidEvent` observer failures are isolated: the stream continues and no `EXT_OBSERVER_FAILED` is produced.

## Narrowing declared HTTP errors

When `defineRequest` declares an `error` struct (including a `struct.discriminatedUnion`), narrowing `error.code === "HTTP_STATUS"` types `error.data` to `Infer<typeof errorStruct>` and provides `error.status`:

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

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
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: OrderError,
});

const client = createClient(withEndpoint("https://api.example.com"));

async function loadOrder(id: number) {
  const [error, order] = await getOrder(client, { id });
  if (error) {
    if (error.code === "HTTP_STATUS") {
      switch (error.data.kind) {
        case "not_found":
          console.warn("Missing order", error.data.orderId);
          return;
        case "rate_limit":
          console.warn("Retry after", error.data.retryAfterSeconds);
          return;
      }
    }
    console.error(error.code, error.message);
    return;
  }
  console.log(order.status);
}

void loadOrder(7);
```

- If a non-2xx HTTP response body fails the declared `error` struct, the fault code is `RES_STRUCT_MISMATCH` (not `HTTP_STATUS`), so `if (error.code === "HTTP_STATUS")` guarantees `error.data` matches the declared struct.

## Triaging and logging faults

Switch on `fault.code` and inspect `fault.cause instanceof StructError` for schema mismatch details:

```ts
import { StructError, type AnyFault } from "@defjs/core";

export function logAndTriage(fault: AnyFault): string {
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify());
  }
  switch (fault.code) {
    case "HTTP_STATUS":
      return `status ${fault.status}`;
    case "RES_MEDIA_TYPE_INVALID":
    case "RES_DECODE_FAILED":
    case "RES_STRUCT_MISMATCH":
      return "contract mismatch";
    case "NET_TIMEOUT":
    case "NET_ABORTED":
    case "NET_UNREACHABLE":
    case "NET_BODY_INCOMPLETE":
      return "transport or canceled";
    case "REQ_INPUT_INVALID":
    case "REQ_OPTIONS_INVALID":
    case "REQ_BUILD_FAILED":
      return "caller bug";
    case "EXT_INTERCEPTOR_FAILED":
    case "EXT_HOOK_FAILED":
    case "EXT_OBSERVER_FAILED":
      return "extension bug";
    case "CAP_BUFFER_EXCEEDED":
    case "CAP_QUEUE_OVERFLOW":
      return "capacity exceeded";
    case "ENV_UNSUPPORTED":
      return "unsupported runtime";
  }
}
```
