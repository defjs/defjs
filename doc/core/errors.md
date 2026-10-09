---
title: Errors
description: Branch on one closed set of fault codes for 404s, timeouts, unreadable bodies, and transport failures.
---

# Errors

Handle a 404, a timeout, or an unreadable body by reading the error-first tuple — not by catching
throws. A `Fault` is a native `Error` (`instanceof Error` is true) discriminated by one field:
`code`.

There is no `kind`. The class of a failure is the segment before the first `_` in its code, so
`NET_TIMEOUT` is a `NET` failure and `RES_STRUCT_MISMATCH` is a `RES` failure. Read the prefix for
coarse triage and the whole code for an exact case.

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

const [err, user, response] = await client.execute(getUser({ id: 7 }))
if (err?.code === 'HTTP_STATUS' && err.status === 404) {
  console.log(err.data.message)
} else if (err?.code === 'NET_TIMEOUT') {
  console.log('timed out')
} else if (err?.code === 'RES_STRUCT_MISMATCH') {
  console.log('the response did not match what we declared', err.response.status)
} else if (!err) {
  console.log(user.name, response.status)
}
```

Because the set is closed, a `switch` over `code` is exhaustive:

```typescript twoslash
import { createNetworkFault, ERR_ABORTED, type Fault } from '@defjs/core'

function triage(fault: Fault): string {
  switch (fault.code) {
    case 'HTTP_STATUS':
      return `status ${fault.status}`
    case 'RES_MEDIA_TYPE_INVALID':
    case 'RES_DECODE_FAILED':
    case 'RES_STRUCT_MISMATCH':
      return 'the contract did not hold'
    case 'NET_TIMEOUT':
    case 'NET_ABORTED':
    case 'NET_UNREACHABLE':
    case 'NET_BODY_INCOMPLETE':
      return 'retryable'
    case 'REQ_INPUT_INVALID':
    case 'REQ_OPTIONS_INVALID':
    case 'REQ_BUILD_FAILED':
      return 'fix the call'
    case 'EXT_INTERCEPTOR_FAILED':
    case 'EXT_HOOK_FAILED':
    case 'EXT_OBSERVER_FAILED':
      return 'fix the code you attached'
    case 'CAP_BUFFER_EXCEEDED':
    case 'CAP_QUEUE_OVERFLOW':
      return 'raise a declared limit or read faster'
    case 'ENV_UNSUPPORTED':
      return 'the host runtime is missing something'
  }
}

const example: Fault = createNetworkFault(ERR_ABORTED)
console.log(triage(example))
```

## Stable codes

| Class  | Codes                                                                  | Who has to change                                      |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `HTTP` | `HTTP_STATUS`                                                          | The peer answered non-2xx; handle it as business logic |
| `REQ`  | `REQ_INPUT_INVALID`, `REQ_OPTIONS_INVALID`, `REQ_BUILD_FAILED`         | The call or the endpoint declaration                   |
| `NET`  | `NET_ABORTED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `NET_BODY_INCOMPLETE` | Nobody, or retry                                       |
| `RES`  | `RES_MEDIA_TYPE_INVALID`, `RES_DECODE_FAILED`, `RES_STRUCT_MISMATCH`   | The declaration and the peer have to be reconciled     |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`     | The code you attached to the pipeline                  |
| `CAP`  | `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`                            | A declared limit, or the consumer's pace               |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | The host runtime                                       |

The set is closed on purpose: that is what keeps a `switch` exhaustive. Extensions report their own
detail through `cause`, not through a new code.

### Fields by shape

| Code            | `status` | `response`                                                    | `data`                               |
| --------------- | -------- | ------------------------------------------------------------- | ------------------------------------ |
| `HTTP_STATUS`   | Always   | Always; has `body` only when `error` was declared and decoded | Decoded `error` body, or `undefined` |
| `RES_*`         | Always   | Always, metadata only — **no `body`**                         | Absent                               |
| Everything else | Absent   | Only where the transport already had metadata                 | Absent                               |

`cause` carries the underlying value: a `StructError` for a struct mismatch, the parser failure for
an unreadable representation, whatever an extension threw.

## Tuple shapes by transport

```typescript twoslash
import type {
  DecodedResponse,
  EventStreamHandle,
  EventStreamOpenInfo,
  Fault,
  HttpMeta,
  WebSocketConnectionInfo,
  WebSocketSession,
} from '@defjs/core'

type HttpResult =
  [err: null, data: unknown, response: DecodedResponse<unknown> | HttpMeta] | [err: Fault, data: undefined, response: undefined]
type SseResult =
  | [err: null, stream: EventStreamHandle<unknown>, open: EventStreamOpenInfo]
  | [err: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]
type SocketResult =
  | [err: null, session: WebSocketSession<unknown>, connection: WebSocketConnectionInfo]
  | [err: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const results: [HttpResult, SseResult, SocketResult] | undefined = undefined
void results
```

On an HTTP failure the third slot is `undefined`: the fault already carries whatever response
metadata existed. That matters because a fault is what you pass to a handler, log, or rethrow, so
the metadata has to travel _with_ it rather than beside it.

For SSE and WebSocket the third slot is a startup snapshot, which can be present even when startup
failed. After a handle or session returns, later failures live on its lifecycle — they never
rewrite the settled startup tuple.

## How a body is read

`ok` is the only fork, and only one side ever decodes. `output` reads a 2xx body; `error` reads
everything else. Omitting one means that body is never read.

| Situation                                              | Outcome                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| 2xx, `output` declared, body decodes                   | Success; `data` and `response.body` typed                      |
| 2xx, `output` omitted                                  | Success; `data` is `undefined`, response has no `body`         |
| Non-2xx, `error` declared, body decodes                | `HTTP_STATUS` with typed `data`                                |
| Non-2xx, `error` omitted                               | `HTTP_STATUS` with `data: undefined`                           |
| The media type is not what the representation needs    | `RES_MEDIA_TYPE_INVALID`, reported **before** the body is read |
| The bytes are not that representation                  | `RES_DECODE_FAILED`                                            |
| The value is not that struct                           | `RES_STRUCT_MISMATCH`                                          |
| An unreadable body on the side you did **not** declare | Ignored entirely — see below                                   |

That last row is the one worth remembering. If you declared `output` but not `error`, a 500 whose
body is malformed JSON is reported as `HTTP_STATUS` with `status: 500`. You said you did not care
about error bodies, and that includes not caring that one could not be read.

Decoding happens once, after the interceptor chain. A response an interceptor built with
`makeResponse(...)` goes through the same media-type check and the same struct as one off the wire.

`HttpResponse.ok` means only `200 <= status < 300`. A transport failure is a fault, never a
response — there is no status-0 response standing in for one.

## Narrowing an error body union

One `error` struct covers every non-2xx status, so when the shapes differ you declare a union. What
you can do with `fault.data` afterwards depends entirely on how you declared that union — the
library hands back exactly the type you asked for.

`struct.or(...)` produces a plain union, which TypeScript cannot narrow by itself. Test for the
field you need:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` narrows on a field the body actually carries, which is the
comfortable form when the API already tags its errors:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('validation'), fields: struct.array(struct.string()) }),
  struct.object({ kind: struct.literal('rateLimit'), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS') {
  switch (fault.data.kind) {
    case 'validation':
      console.log(fault.data.fields.length)
      break
    case 'rateLimit':
      console.log(fault.data.retryAfter)
      break
  }
}
```

When the API puts the status **inside** the body, discriminate on that instead of on
`fault.status`:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('status', [
  struct.object({ status: struct.literal(404), resource: struct.string() }),
  struct.object({ status: struct.literal(429), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && fault.data.status === 429) {
  console.log(fault.data.retryAfter)
}
```

That last form is worth preferring where the API supports it. `fault.status` is the HTTP-layer
number, which a proxy, gateway, or CDN can rewrite; `data.status` was decoded from the body your
`error` struct asserted, so reaching it is proof the backend produced it.

A non-discriminated union that will not narrow is a property of the declaration, not of the
library — it hands you the type you declared. Add a discriminant to the struct if you want one.

## Startup vs post-open

SSE validates status, `text/event-stream`, and the presence of a body before resolving the handle.
Non-2xx → `HTTP_STATUS`. Wrong media type → `RES_MEDIA_TYPE_INVALID`. Missing body →
`RES_DECODE_FAILED`. The opening snapshot can still land in the third tuple slot.

WebSocket startup covers the handshake plus the first physical open. Constructor failure, pre-open
close, timeout, or cancel all produce a startup tuple. A connection snapshot may exist even when
the socket never reached `open`.

| Transport | After startup                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSE       | The iterator rejects on a fatal error; `stream.closed` resolves with `kind: 'error'` and the fault `code`                                              |
| WebSocket | `onRuntimeError` for message/queue/heartbeat failures; `receive` fails on terminal errors; `session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP      | The execute promise settles once. Interceptor and callback code can still throw outside tuple normalization                                            |

`NET_ABORTED` / `NET_TIMEOUT` describe what the caller saw at startup. You still close a returned
stream or session and await its terminal promise.

## Native Error logging and cause

Faults are native `Error` instances, so no diagnostic adapter is needed. `String(fault)` gives the
stable native form `DefjsFault: <message>`. `code` and the variant fields — `status`, `response`,
`data` — stay enumerable for structured logging; `name` and the native `cause` chain are
non-enumerable.

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

Narrow `fault.cause instanceof StructError` before calling `format()`, `flatten()`, or
`prettify()`. Those helpers live on the Struct cause; they are not copied onto the fault. Don't
make control flow parse `message` or `String(fault)` — `code` and a reviewed `status` are the
contract.

## Reference

| Branch                 | Control-flow check                 | Useful stable fields                     | Usually absent / sensitive        |
| ---------------------- | ---------------------------------- | ---------------------------------------- | --------------------------------- |
| HTTP status policy     | `fault.code === 'HTTP_STATUS'`     | `fault.status`, reviewed `fault.data`    | Body, headers, URL, `cause`       |
| Caller cancellation    | `fault.code === 'NET_ABORTED'`     | `code`                                   | Abort reason and stack            |
| Timeout                | `fault.code === 'NET_TIMEOUT'`     | `code`                                   | Request URL and underlying cause  |
| The contract broke     | `fault.code.startsWith('RES_')`    | `code`, reviewed `fault.response.status` | Struct issues, body, input values |
| Your own code threw    | `fault.code.startsWith('EXT_')`    | `code`, `cause`                          | Whatever the extension attached   |
| Stream/session runtime | `stream.closed` / `session.closed` | Terminal `kind` and `code`               | Event payloads, frames, causes    |

Treat `cause`, `data`, response headers and bodies, URLs, Struct issues, input values, and stacks as
sensitive. A conservative summary:

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`, `createPreflightFault`, `createDecodeFault`, `createHttpStatusFault`, and
`createUndecodedHttpStatusFault` build these native Error values. Normal request failures still
return them in the tuple; they are not thrown merely because they inherit native Error behavior.
`ERR_ABORTED` and `ERR_TIMEOUT` are the shared causes the transport normalizer recognizes.

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
