---
title: HTTP
description: defineRequest、execute options、HTTP の request/response 型です。
---

# HTTP

型付きリクエストを宣言し、入力からコマンドを組み立てて実行します。

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`、`path`、任意の `input` struct、任意の `builder`、任意の `output` と `error` struct、任意の `operation`。
- **戻り値** エンドポイントです。入力を渡して呼ぶと `HttpCommand` になります。

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

`output` は 2xx ボディ用の struct 1 つ、`error` は 2xx 以外すべてのボディ用の struct 1 つです。どちらも status でキー分けされません。省いた側のボディは読まれません — [宣言は断言である](/guide/design-decisions#declaration-is-an-assertion) を参照してください。

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

`client.execute` が使う低レベル入口です。アプリコードでは `client.execute(command, options)` を呼んでください。

- **戻り値** `[null, data, response]` または `[fault, undefined, undefined]`。

2xx 以外の status は常に `HTTP_STATUS` です。`error` を宣言していればその `data` はデコード済みのエラーボディ、していなければ `undefined` です。失敗時のタプル第三要素は `undefined` で、レスポンスのメタデータは fault が持ちます。

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

デフォルトの HTTP トランスポートです。`withHTTPHandle` で差し替えない限り使われます。レスポンスがクライアントに届かなかったときは、合成レスポンスで解決するのではなく reject します。

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

ネットワークなしで `HttpResponse` を作ります（インターセプター、テスト）。デフォルトの status は `0` です。`ok` は 2xx のとき true です。返る値は、回線から来たレスポンスと同じメディアタイプ確認と同じ宣言 struct を通ります。信頼による短絡経路はありません。

## 実行 options

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

キャンセルは `abort` **または** `timeout` の一方だけで、両方は使えません。`signal` はどちらかと組み合わせられ、`abort` の別名では**ありません**。有効な形は `{ timeout }`、`{ abort }`、`{ signal, timeout }`、`{ signal, abort }` です。`{ abort, timeout }` は無効です。`timeout` は `1..2_147_483_647` の正の安全な整数である必要があります。

## 型

### RequestDefinition {#RequestDefinition}

`method`、`path`、任意の `input`、`builder`、`output`、`error`、`operation` です。`responseType` はありません。宣言したボディの読み方は struct の kind が選びます。

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

`RequestDefinition` の `output` / `error` の側です。どちらも無いとき、ボディは読まれません。

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

成功時、第三要素が `body` を持つのは `output` を宣言していたときだけです。失敗時は `undefined` です — 存在したレスポンスのメタデータはすでに fault が抱えています。

### HttpRequest {#HttpRequest}

正規化された送信リクエストです。`method`、`endpoint`、`headers`、`body`、`abort`、`operation`、progress フック、`baseEndpoint`、`queryString`、`queryParams` です。インターセプターが見る `queryParams` は `new URLSearchParams(queryString)` です。ビルダーが `URLSearchParams` を返すと、そのインスタンスがそのまま渡されます。`responseType` と `errorResponseType` は readonly です。エンドポイントの `output` と `error` の struct kind から導出され、変更してはいけません。

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

レスポンスのメタデータで、レスポンスがクライアントに届いていれば使えます。`body` は**持ちません**。ボディは、宣言された struct がデコードしたあとにだけ存在します。

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

ボディが宣言された struct でデコードできたレスポンスです。この型を手にしていること自体がデコードが起きた証拠であり、だからデコード失敗は `HttpMeta` だけを報告します。

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

トランスポートが作り、インターセプターが見る回線上の形です。`body` はテキストか、すでにパースされた JSON で、デコード済みの値ではありません。JSON 表現では、文字列は JSON の文字列ルートであり、もう一度パースされません。バイトと blob は生のままで、一度だけパースされます。呼び出し側に届くのは `DecodedResponse` です。

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`、`total`、`lengthComputable` です。コールバックは async でも構いません。コールバックが throw したら `EXT_OBSERVER_FAILED` です。

[HTTP ガイド](/core/http) と [Commands](/core/commands) を見てください。

## RequestEndpoint {#RequestEndpoint}

`defineRequest` の戻り値です。入力を渡して呼ぶと `HttpCommand` になります。

## BuilderInput {#BuilderInput}

`builder` が見る、パース済みのエンドポイント入力です。オブジェクトノードはそれを生んだ struct を運ぶので、エイリアス、`Date`、`bigint` のエンコードは値についてきます。

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` と `HEAD` はボディを返せません。`path` と `headers` はフラットなスカラーである必要があります。`query` は入れ子になれ、入れ子オブジェクトには実行時の `withQuerySerializer` が要ります。

## HttpCommand {#HttpCommand}

リクエストのビルダーが出す不透明なコマンドです。`client.execute` に渡します。

## UseRequestConfig {#UseRequestConfig}

進捗とキャンセルのフィールドです。`HttpExecuteOptions` は `signal` を足します。

## RequestSuccessData {#RequestSuccessData}

宣言された `output` struct から推論される成功ボディです。宣言がなければ `undefined` です。

## RequestErrorData {#RequestErrorData}

宣言された `error` struct から推論されるエラーボディです。宣言がなければ `undefined` です。

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

宣言した struct の kind から選ばれます（`string` → `text`、`blob` / `file` → `blob`、`arrayBuffer` → `arraybuffer`、それ以外 → `json`）。`defineRequest` のフィールドではありません。

## MakeResponseOptions {#MakeResponseOptions}

`makeResponse` 用のフィールドです。`status`、`statusText`、`url`、`headers`、`body`、`request`。
