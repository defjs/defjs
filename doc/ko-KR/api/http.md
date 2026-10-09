---
title: HTTP
description: defineRequest, 실행 options, HTTP request/response 타입이에요.
---

# HTTP

타입이 있는 요청을 선언하고, 입력으로 명령을 만든 뒤 실행해요.

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`, `path`, 선택 `input` struct, 선택 `builder`, 선택 `output`과 `error` struct, 선택 `operation`이에요.
- **반환** 엔드포인트예요. 입력을 넣어 호출하면 `HttpCommand`가 나와요.

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

`output`은 2xx body를 위한 struct 하나이고, `error`는 모든 non-2xx body를 위한 struct 하나예요. 둘 다 status로 키를 나누지 않아요. 하나를 빼면 그 body는 읽히지 않아요 — [선언은 단언이에요](/guide/design-decisions#declaration-is-an-assertion)를 보세요.

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

`client.execute`가 쓰는 저수준 진입점이에요. 애플리케이션 코드는 `client.execute(command, options)`를 호출해야 해요.

- **반환** `[null, data, response]` 또는 `[fault, undefined, undefined]`예요.

2xx가 아닌 status는 항상 `HTTP_STATUS`예요. `data`는 `error`를 선언했을 때 디코딩된 `error` body이고, 아니면 `undefined`예요. 실패하면 튜플의 세 번째 자리는 `undefined`이고, fault가 응답 메타데이터를 가져요.

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

기본 HTTP 전송이에요. `withHTTPHandle`이 바꾸지 않는 한 이걸 써요. 응답이 클라이언트에 닿지 않으면 synthetic 응답으로 resolve하지 않고 reject해요.

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

네트워크 호출 없이 `HttpResponse`를 만들어요 (interceptor, 테스트). 기본 status는 `0`이에요. `ok`는 2xx일 때 true예요. 반환값은 와이어에서 온 응답과 같은 미디어 타입 검사와 같은 선언된 struct를 거쳐요. 신뢰하는 short-circuit은 없어요.

## 실행 options

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

취소는 `abort` **또는** `timeout`이지, 둘 다가 아니에요. `signal`은 어느 쪽과도 조합돼요. `abort`의 별칭이 **아니에요**. 유효한 모양: `{ timeout }`, `{ abort }`, `{ signal, timeout }`, `{ signal, abort }`. `{ abort, timeout }`은 유효하지 않아요. `timeout`은 `1..2_147_483_647` 범위의 양의 안전 정수여야 해요.

## 타입

### RequestDefinition {#RequestDefinition}

`method`, `path`, 선택 `input`, `builder`, `output`, `error`, `operation`이에요. `responseType`은 없어요. struct kind가 선언된 body를 어떻게 읽을지 골라요.

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

`RequestDefinition`의 `output` / `error` 쪽이에요. 둘 다 없으면 body는 읽히지 않아요.

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

성공하면 세 번째 자리는 `output`을 선언했을 때만 `body`를 가져요. 실패하면 `undefined`예요 — fault가 이미 있던 응답 메타데이터를 들고 있어요.

### HttpRequest {#HttpRequest}

정규화된 나가는 요청이에요. `method`, `endpoint`, `headers`, `body`, `abort`, `operation`, progress hook, `baseEndpoint`, `queryString`, `queryParams`예요. interceptor가 보는 `queryParams`는 `new URLSearchParams(queryString)`이에요. builder가 `URLSearchParams`를 돌려주면 그 인스턴스가 그대로 통과해요. `responseType`과 `errorResponseType`은 readonly예요. 엔드포인트의 `output`과 `error` struct kind에서 유도되며, 바꾸면 안 돼요.

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

응답이 클라이언트에 닿을 때마다 있는 응답 메타데이터예요. **`body`는 없어요**. body는 선언된 struct가 하나를 디코딩한 뒤에만 존재해요.

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

선언된 struct에 대해 body가 디코딩된 응답이에요. 이 타입을 들고 있다는 것은 디코딩이 일어났다는 증거라서, 디코딩 실패는 `HttpMeta`만 보고해요.

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

전송이 만들고 interceptor가 보는 와이어 모양이에요. `body`는 텍스트이거나 이미 파싱된 JSON이지, 디코딩된 값이 아니에요. JSON 표현에서 문자열은 JSON 문자열 루트라서 다시 파싱하지 않아요. bytes와 blob은 원시 값이라 한 번만 파싱해요. 호출자에게 닿는 것은 `DecodedResponse`예요.

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`, `total`, `lengthComputable`이에요. 콜백은 async일 수 있어요. 콜백이 throw하면 `EXT_OBSERVER_FAILED`예요.

[HTTP 가이드](/core/http)와 [명령](/core/commands)을 보세요.

## RequestEndpoint {#RequestEndpoint}

`defineRequest`가 돌려줘요. 입력을 넣어 호출하면 `HttpCommand`가 나와요.

## BuilderInput {#BuilderInput}

`builder`가 보는, 파싱된 엔드포인트 입력이에요. 객체 노드는 자신을 만든 struct를 지니므로 alias, `Date`, `bigint` 인코딩이 그 값을 따라가요.

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET`과 `HEAD`는 body를 돌려줄 수 없어요. `path`와 `headers`는 평평한 스칼라여야 하고, `query`는 중첩될 수 있어요. 중첩 객체는 런타임에 `withQuerySerializer`가 필요해요.

## HttpCommand {#HttpCommand}

요청 builder가 만든 opaque 명령이에요. `client.execute`에 넘기세요.

## UseRequestConfig {#UseRequestConfig}

진행률과 취소 필드예요. `HttpExecuteOptions`는 `signal`을 더해요.

## RequestSuccessData {#RequestSuccessData}

선언된 `output` struct에서 추론한 성공 body예요. 선언이 없으면 `undefined`예요.

## RequestErrorData {#RequestErrorData}

선언된 `error` struct에서 추론한 오류 body예요. 선언이 없으면 `undefined`예요.

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

선언된 struct kind에서 골라요 (`string` → `text`, `blob` / `file` → `blob`, `arrayBuffer` → `arraybuffer`, 그 밖은 `json`). `defineRequest`의 필드가 아니에요.

## MakeResponseOptions {#MakeResponseOptions}

`makeResponse`의 필드예요. `status`, `statusText`, `url`, `headers`, `body`, `request`.
