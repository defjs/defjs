---
title: HTTP
description: defineRequest, execute options, and HTTP request/response types.
---

# HTTP

Declare a typed request, build a command from input, execute it.

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`, `path`, optional `input` struct, optional `builder`, optional `output` and `error` structs, optional `operation`.
- **Returns** an endpoint. Call it with input to get an `HttpCommand`.

```ts
import { defineRequest, struct } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})
```

`output` is one struct for the 2xx body; `error` is one struct for every non-2xx body. Neither is
keyed by status. Omitting one means that body is never read — see
[Declaration is an assertion](/guide/design-decisions#declaration-is-an-assertion).

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

Low-level entry used by `client.execute`. Application code should call `client.execute(command, options)`.

- **Returns** `[null, data, response]` or `[fault, undefined, undefined]`.

A non-2xx status is always `HTTP_STATUS`. Its `data` is the decoded `error` body when one was
declared, and `undefined` otherwise. On failure the tuple's third slot is `undefined`; the fault
carries the response metadata.

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

Default HTTP transport. Used unless `withHTTPHandle` replaces it. It rejects — rather than resolving
with a synthetic response — when no response reached the client.

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

Build an `HttpResponse` without a network call (interceptors, tests). Default status is `0`. `ok` is
true for 2xx. The value it returns goes through the same media-type check and the same declared
struct as one off the wire; there is no trusted short-circuit.

## Execute options

## HttpExecuteOptions {#HttpExecuteOptions}

```ts
type HttpExecuteOptions = {
  onDownloadProgress?: HttpProgressFn
  onUploadProgress?: HttpProgressFn
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

Cancellation is `abort` **or** `timeout`, not both. `signal` combines with either; it is **not** an alias for `abort`. Valid shapes: `{ timeout }`, `{ abort }`, `{ signal, timeout }`, `{ signal, abort }`. `{ abort, timeout }` is invalid. `timeout` must be a positive safe integer in `1..2_147_483_647`.

## Types

### RequestDefinition {#RequestDefinition}

`method`, `path`, optional `input`, `builder`, `output`, `error`, and `operation`. There is no `responseType`: the struct kind selects how a declared body is read.

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

The `output` / `error` half of a `RequestDefinition`. When both are absent the body is never read.

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

On success the third slot carries `body` only when `output` was declared. On failure it is
`undefined` — the fault already holds whatever response metadata existed.

### HttpRequest {#HttpRequest}

Normalized outgoing request: `method`, `endpoint`, `headers`, `body`, `abort`, `operation`, progress hooks, `baseEndpoint`, `queryString`, and `queryParams`. Interceptors see `queryParams` as `new URLSearchParams(queryString)`. A builder that returns `URLSearchParams` passes that instance through. `responseType` and `errorResponseType` are readonly: they are derived from the endpoint's `output` and `error` struct kinds and must not be changed.

### HttpMeta {#HttpMeta}

```ts
type HttpMeta = {
  readonly headers: Headers
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly url: string
}
```

Response metadata, available whenever a response reached the client. It carries **no** `body`: a body
only exists once a declared struct decoded one.

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

A response whose body decoded against the declared struct. Holding this type is the proof that
decoding happened, which is why a decode failure reports `HttpMeta` alone.

### HttpResponse {#HttpResponse}

```ts
type HttpResponse<R> = {
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly body: R | null
  readonly ok: boolean
}
```

The wire shape transports produce and interceptors see: `body` is text or already-parsed JSON, not a
decoded value. For a JSON representation, a string is a JSON string root and is not parsed again; bytes
and blobs are raw and are parsed once. `DecodedResponse` is what reaches the caller.

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`, `total`, `lengthComputable`. Callbacks may be async. A callback that throws is
`EXT_OBSERVER_FAILED`.

See [HTTP guide](/core/http) and [Commands](/core/commands).

## RequestEndpoint {#RequestEndpoint}

Returned by `defineRequest`. Call with input to get an `HttpCommand`.

## BuilderInput {#BuilderInput}

Parsed endpoint input seen by `builder`. Object nodes carry the struct that produced them, so alias, `Date`, and `bigint` encoding follow the value.

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` and `HEAD` cannot return a body. `path` and `headers` must be flat scalars; `query` may nest, and a nested object needs `withQuerySerializer` at runtime.

## HttpCommand {#HttpCommand}

Opaque command from a request builder. Pass to `client.execute`.

## UseRequestConfig {#UseRequestConfig}

Progress and cancellation fields. `HttpExecuteOptions` adds `signal`.

## RequestSuccessData {#RequestSuccessData}

Inferred success body from the declared `output` struct, or `undefined` when none is declared.

## RequestErrorData {#RequestErrorData}

Inferred error body from the declared `error` struct, or `undefined` when none is declared.

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

Chosen from the declared struct kind (`string` → `text`, `blob` / `file` → `blob`, `arrayBuffer` → `arraybuffer`, everything else → `json`). Not a field on `defineRequest`.

## MakeResponseOptions {#MakeResponseOptions}

Fields for `makeResponse`: `status`, `statusText`, `url`, `headers`, `body`, `request`.
