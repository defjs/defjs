---
title: HTTP
description: defineRequest、execute options，以及 HTTP request／response 型別。
---

# HTTP

宣告型別化的 request，從 input 組出 command，再執行。

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`、`path`，選填 `input` struct、`output` 與 `error` struct，以及 `operation`。只要宣告了 `input`，就必須明確提供 `builder`，即使輸入已經是請求形狀也一樣。只有沒有 `input` 的定義可以省略 `builder`。
- **回傳** endpoint。帶 input 呼叫就得到 `HttpCommand`。

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

`output` 是 2xx body 的單一 struct；`error` 是每個非 2xx body 的單一 struct。兩者都不按狀態碼分鍵。省略哪個，那個 body 就根本不會被讀——見 [宣告即斷言](/guide/design-decisions#declaration-is-an-assertion)。

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

`client.execute` 走的低階入口。寫功能時請呼叫 `client.execute(command, options)`。

- **回傳** `[null, data, response]` 或 `[fault, undefined, undefined]`。

非 2xx 狀態一律是 `HTTP_STATUS`。宣告過 `error` 時它的 `data` 是解碼後的錯誤 body，否則是 `undefined`。失敗時 tuple 第三項是 `undefined`；回應 metadata 由 fault 攜帶。

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

預設 HTTP 傳輸。除非被 `withHTTPHandle` 換掉。它在沒有回應到達 client 時會 reject，而不是 resolve 成一個合成回應。

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

不打網路也能組出 `HttpResponse`（interceptors、測試）。預設 status 是 `0`。2xx 時 `ok` 為 true。它回傳的值會走和線上回應完全一樣的媒體類型檢查與宣告 struct；不存在受信任的短路。

## 執行 options

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

取消用 `abort` **或** `timeout`，不能兩個一起。`signal` 可與其中任一組合，**不是** `abort` 的別名。合法形狀：`{ timeout }`、`{ abort }`、`{ signal, timeout }`、`{ signal, abort }`。`{ abort, timeout }` 非法。`timeout` 必須是 `1..2_147_483_647` 的正 safe integer。

## 型別

### RequestDefinition {#RequestDefinition}

`method`、`path`，可選 `input`、`output`、`error`、`operation`。沒有 `responseType`：struct kind 決定已宣告的 body 怎麼讀。只要宣告了 `input`，就必須明確提供 `builder`，即使輸入已經是請求形狀也一樣。只有沒有 `input` 的定義可以省略 `builder`。

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

`RequestDefinition` 裡 `output`／`error` 那一半。兩個都不在時，body 根本不會被讀。

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

成功時第三項只有在宣告過 `output` 時才帶 `body`。失敗時它是 `undefined`——fault 已經握著當時存在的回應 metadata。

### HttpRequest {#HttpRequest}

正規化後的外送 request：`method`、`endpoint`、`headers`、`body`、`abort`、`operation`、progress hooks、`baseEndpoint`、`queryString`、`queryParams`。Interceptors 看到的 `queryParams` 是 `new URLSearchParams(queryString)`。Builder 回傳 `URLSearchParams` 時會把那個實例傳下去。`responseType` 與 `errorResponseType` 是唯讀的：它們由端點的 `output` 與 `error` struct kind 推導而來，不能修改。

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

回應 metadata，只要有回應到達 client 就有。它**不**帶 `body`：body 只有在宣告過的 struct 解出來之後才存在。

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

body 已按宣告的 struct 解碼成功的回應。拿到這個型別就是解碼確實發生過的證明——這也正是解碼失敗時只報 `HttpMeta` 的原因。

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

傳輸產出、interceptor 看到的線上形狀：`body` 是文字或已解析的 JSON，不是解碼後的值。對於 JSON 表示，字串是 JSON 字串根，不會再次解析；位元組和 blob 仍是原始資料，只解析一次。到達呼叫方的是 `DecodedResponse`。

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`、`total`、`lengthComputable`。Callbacks 可以是 async。回呼丟出錯誤就是 `EXT_OBSERVER_FAILED`。

見 [HTTP 指南](/core/http) 與 [Commands](/core/commands)。

## RequestEndpoint {#RequestEndpoint}

`defineRequest` 的回傳值。帶 input 呼叫就得到 `HttpCommand`。

## BuilderInput {#BuilderInput}

`builder` 看到的、已剖析的 endpoint input。物件節點帶著產出它們的 struct，所以 alias、`Date`、`bigint` 編碼跟著值走。

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` 與 `HEAD` 不能回傳 body。`path` 與 `headers` 必須是扁平 scalars；`query` 可以巢狀，巢狀物件在執行階段需要 `withQuerySerializer`。

## HttpCommand {#HttpCommand}

請求 builder 吐出的不透明 command。丟給 `client.execute`。

## UseRequestConfig {#UseRequestConfig}

進度與取消欄位。`HttpExecuteOptions` 再加一個 `signal`。

## RequestSuccessData {#RequestSuccessData}

從宣告的 `output` struct 推出來的成功 body；沒宣告時是 `undefined`。

## RequestErrorData {#RequestErrorData}

從宣告的 `error` struct 推出來的錯誤 body；沒宣告時是 `undefined`。

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

由宣告的 struct kind 決定（`string` → `text`，`blob`／`file` → `blob`，`arrayBuffer` → `arraybuffer`，其餘 → `json`）。不是 `defineRequest` 上的欄位。

## MakeResponseOptions {#MakeResponseOptions}

給 `makeResponse` 的欄位：`status`、`statusText`、`url`、`headers`、`body`、`request`。
