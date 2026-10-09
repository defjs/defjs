---
title: HTTP
description: defineRequest、execute options，同 HTTP request/response types。
---

# HTTP

Declare 一個 typed request，用 input build command，之後 execute。

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`、`path`，可選 `input` struct，可選 `builder`，可選 `output` 同 `error` structs，可選 `operation`。
- **Returns** 一個 endpoint。用 input call 佢，就會得到 `HttpCommand`。

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

`output` 係 2xx body 嘅單一 struct；`error` 係每個非 2xx body 嘅單一 struct。兩者都唔會按 status code 分 key。唔寫邊個，嗰個 body 就根本唔會被讀——睇
[聲明即斷言](/guide/design-decisions#declaration-is-an-assertion)。

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

Low-level entry，`client.execute` 用呢個。Application code 應該 call `client.execute(command, options)`。

- **Returns** `[null, data, response]` 或 `[fault, undefined, undefined]`。

非 2xx status 一律係 `HTTP_STATUS`。聲明過 `error` 嘅時候佢個 `data` 係解碼之後嘅 error body，否則就係 `undefined`。失敗時 tuple 第三項係 `undefined`；response metadata 由 fault 帶住。

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

Default HTTP transport。除非 `withHTTPHandle` 換走佢，否則就用呢個。冇 response 到達 client 嘅時候佢會 reject，而唔係 resolve 一個合成 response。

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

唔打 network 都 build 到 `HttpResponse`（interceptors、tests）。Default status 係 `0`。2xx 嘅時候 `ok` 係 true。佢回嘅值會走同線上 response 一模一樣嘅 media-type 檢查同聲明 struct；唔存在受信任嘅短路。

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

Cancellation 係 `abort` **或者** `timeout`，唔可以兩個一齊。`signal` 可以同其中一個一齊用，**唔係** `abort` 嘅 alias。合法形狀：`{ timeout }`、`{ abort }`、`{ signal, timeout }`、`{ signal, abort }`。`{ abort, timeout }` 唔得。`timeout` 一定要係 `1..2_147_483_647` 入面嘅 positive safe integer。

## Types

### RequestDefinition {#RequestDefinition}

`method`、`path`，可選 `input`、`builder`、`output`、`error` 同 `operation`。冇 `responseType`：struct kind 決定一個已聲明 body 點讀。

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

`RequestDefinition` 裡面 `output` / `error` 嗰一半。兩個都唔寫嘅時候，body 根本唔會被讀。

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

成功時第三項只有聲明過 `output` 才會帶 `body`。失敗時佢係 `undefined`——fault 已經揸住當時存在嘅 response metadata。

### HttpRequest {#HttpRequest}

Normalized outgoing request：`method`、`endpoint`、`headers`、`body`、`abort`、`operation`、progress hooks、`baseEndpoint`、`queryString` 同 `queryParams`。Interceptors 見到嘅 `queryParams` 係 `new URLSearchParams(queryString)`。Builder return `URLSearchParams` 就會將嗰個 instance 直接傳落去。`responseType` 同 `errorResponseType` 係唯讀：佢哋由端點嘅 `output` 同 `error` struct kind 推導出嚟，唔可以改。

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

Response metadata，只要有 response 到達 client 就有。佢**唔會**帶 `body`：body 要等聲明過嘅 struct 解出嚟之後才存在。

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

Body 已經按聲明嘅 struct 解碼成功嘅 response。拿到呢個 type 就係解碼真係發生過嘅證明——呢個亦正係解碼失敗時只報 `HttpMeta` 嘅原因。

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

Transport 產出、interceptor 見到嘅線上形狀：`body` 係文字或者已經 parse 咗嘅 JSON，唔係解碼之後嘅值。對於 JSON 表示，字串係 JSON 字串根，唔會再 parse 一次；bytes 同 blob 仍然係原始資料，只會 parse 一次。到達 caller 嘅係 `DecodedResponse`。

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`、`total`、`lengthComputable`。Callbacks 可以係 async。Callback 拋錯就係 `EXT_OBSERVER_FAILED`。

睇 [HTTP guide](/core/http) 同 [Commands](/core/commands)。

## RequestEndpoint {#RequestEndpoint}

`defineRequest` 嘅回傳。用 input call 一次就攞到 `HttpCommand`。

## BuilderInput {#BuilderInput}

`builder` 見到嘅、已經 parse 嘅 endpoint input。Object nodes 帶住產生佢哋嘅 struct，所以 alias、`Date` 同 `bigint` encoding 跟住個 value 走。

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` 同 `HEAD` 唔可以 return body。`path` 同 `headers` 一定要係 flat scalars；`query` 可以 nest，nested object 喺 runtime 要有 `withQuerySerializer`。

## HttpCommand {#HttpCommand}

Request builder 吐出嚟嘅 opaque command。交畀 `client.execute`。

## UseRequestConfig {#UseRequestConfig}

Progress 同 cancellation fields。`HttpExecuteOptions` 再加 `signal`。

## RequestSuccessData {#RequestSuccessData}

由聲明嘅 `output` struct 推出嚟嘅成功 body；冇聲明就係 `undefined`。

## RequestErrorData {#RequestErrorData}

由聲明嘅 `error` struct 推出嚟嘅錯誤 body；冇聲明就係 `undefined`。

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

由聲明嘅 struct kind 揀出嚟（`string` → `text`，`blob` / `file` → `blob`，`arrayBuffer` → `arraybuffer`，其他 → `json`）。唔係 `defineRequest` 上面嘅 field。

## MakeResponseOptions {#MakeResponseOptions}

`makeResponse` 用嘅 fields：`status`、`statusText`、`url`、`headers`、`body`、`request`。
