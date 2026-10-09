---
title: HTTP
description: defineRequest、execute options，以及 HTTP 请求/响应类型。
---

# HTTP

声明一次类型化请求，用 input 打出 command，再 execute。

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`、`path`，可选 `input` struct，可选 `builder`，可选 `output` 和 `error` struct，可选 `operation`。
- **返回** 一个 endpoint。塞 input 调用，得到 `HttpCommand`。

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

`output` 是 2xx body 的单一 struct；`error` 是每个非 2xx body 的单一 struct。两者都不按状态码分键。省略哪个，那个 body 就根本不会被读——见 [声明即断言](/guide/design-decisions#declaration-is-an-assertion)。

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

`client.execute` 走的底层入口。业务代码调 `client.execute(command, options)`。

- **返回** `[null, data, response]` 或 `[fault, undefined, undefined]`。

非 2xx 状态一律是 `HTTP_STATUS`。声明过 `error` 时它的 `data` 是解码后的错误 body，否则是 `undefined`。失败时元组第三项是 `undefined`；响应元数据由 fault 携带。

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

默认 HTTP 传输。没被 `withHTTPHandle` 换掉就用它。没有响应到达 client 时它会 reject，而不是 resolve 一个合成响应。

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

不走网络造一个 `HttpResponse`（interceptor、测试）。默认 status 是 `0`。2xx 时 `ok` 为 true。它返回的值会走和线上响应完全一样的媒体类型检查和声明 struct；不存在受信任的短路。

## 执行 options

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

取消是 `abort` **或** `timeout`，不能两个一起。`signal` 可与其中任一组合，**不是** `abort` 的别名。合法形状：`{ timeout }`、`{ abort }`、`{ signal, timeout }`、`{ signal, abort }`。`{ abort, timeout }` 非法。`timeout` 必须是 `1..2_147_483_647` 的正 safe integer。

## 类型

### RequestDefinition {#RequestDefinition}

`method`、`path`，可选 `input`、`builder`、`output`、`error`、`operation`。没有 `responseType`：声明 body 怎么读，由 struct kind 决定。

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

`RequestDefinition` 里 `output` / `error` 那一半。两个都不写时，body 根本不会被读。

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

成功时第三项只有在声明过 `output` 时才带 `body`。失败时它是 `undefined`——fault 已经握着当时存在的响应元数据。

### HttpRequest {#HttpRequest}

规范化后的出站请求：`method`、`endpoint`、`headers`、`body`、`abort`、`operation`、进度 hooks、`baseEndpoint`、`queryString`、`queryParams`。Interceptor 看到的 `queryParams` 是 `new URLSearchParams(queryString)`。builder 返回 `URLSearchParams` 时，传过去的就是那个实例。`responseType` 和 `errorResponseType` 是只读的：它们由端点的 `output` 与 `error` struct kind 推导而来，不能修改。

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

响应元数据，只要有响应到达 client 就有。它**不**带 `body`：body 只有在声明过的 struct 解出来之后才存在。

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

body 已按声明的 struct 解码成功的响应。拿到这个类型就是解码确实发生过的证明——这也正是解码失败时只报 `HttpMeta` 的原因。

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

传输产出、拦截器看到的线上形状：`body` 是文本或已解析的 JSON，不是解码后的值。对于 JSON 表示，字符串是 JSON 字符串根，不会再次解析；字节和 blob 仍是原始数据，只解析一次。到达调用方的是 `DecodedResponse`。

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`、`total`、`lengthComputable`。回调可以是 async。回调抛错就是 `EXT_OBSERVER_FAILED`。

见 [HTTP 指南](/core/http) 和 [Commands](/core/commands)。

## RequestEndpoint {#RequestEndpoint}

`defineRequest` 的返回值。拿 input 调一下就得到 `HttpCommand`。

## BuilderInput {#BuilderInput}

`builder` 看到的、已经 parse 过的 endpoint input。对象节点带着产出它的 struct，所以 alias、`Date`、`bigint` 编码跟着这个值走。

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` 和 `HEAD` 不能返回 body。`path` 和 `headers` 必须是扁平标量；`query` 可以嵌套，嵌套对象在运行时需要 `withQuerySerializer`。

## HttpCommand {#HttpCommand}

请求 builder 吐出来的不透明 command。丢给 `client.execute`。

## UseRequestConfig {#UseRequestConfig}

进度、取消。`HttpExecuteOptions` 再加一个 `signal`。

## RequestSuccessData {#RequestSuccessData}

从声明的 `output` struct 推出来的成功 body；没声明时是 `undefined`。

## RequestErrorData {#RequestErrorData}

从声明的 `error` struct 推出来的错误 body；没声明时是 `undefined`。

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

由声明的 struct kind 选出（`string` → `text`，`blob` / `file` → `blob`，`arrayBuffer` → `arraybuffer`，其余 → `json`）。不是 `defineRequest` 上的字段。

## MakeResponseOptions {#MakeResponseOptions}

给 `makeResponse` 的字段：`status`、`statusText`、`url`、`headers`、`body`、`request`。
