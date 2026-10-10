---
title: HTTP
description: defineRequest, Execute-Options und HTTP-Request-/Response-Types.
---

# HTTP

Deklariere einen typisierten Request, baue aus dem Input einen Command, führe ihn aus.

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`, `path`, optionaler `input`-Struct, optionale `output`- und `error`-Structs, optionales `operation`. Ein deklarierter `input` erfordert immer einen expliziten `builder`, auch wenn der Input bereits die Request-Shape hat. Nur Definitionen ohne `input` dürfen `builder` weglassen.
- **Returns** einen Endpoint. Ruf ihn mit Input auf und du bekommst einen `HttpCommand`.

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

`output` ist ein Struct für den 2xx-Body; `error` ist ein Struct für jeden Non-2xx-Body. Keines von beiden
wird nach Status gekeyt. Lässt du eines weg, wird dieser Body nie gelesen — siehe
[Deklaration ist eine Zusicherung](/guide/design-decisions#declaration-is-an-assertion).

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

Low-Level-Einstieg, den `client.execute` nutzt. Im Application-Code ruf `client.execute(command, options)` auf.

- **Returns** `[null, data, response]` oder `[fault, undefined, undefined]`.

Ein Non-2xx-Status ist immer `HTTP_STATUS`. Sein `data` ist der dekodierte `error`-Body, wenn einer
deklariert war, sonst `undefined`. Bei einem Failure ist der dritte Tuple-Slot `undefined`; die
Response-Metadaten trägt der Fault.

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

Default-HTTP-Transport. Wird genutzt, bis `withHTTPHandle` ihn ersetzt. Er rejectet — statt mit einer
synthetischen Response zu resolven —, wenn keine Response den Client erreicht hat.

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

Baue eine `HttpResponse` ohne Network-Call (Interceptors, Tests). Default-Status ist `0`. `ok` ist
true für 2xx. Der zurückgegebene Wert geht durch dieselbe Media-Type-Prüfung und denselben deklarierten
Struct wie eine Response von der Leitung; es gibt keinen vertrauten Short-Circuit.

## Execute-Optionen

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

Cancellation ist `abort` **oder** `timeout`, nicht beides. `signal` kombiniert mit einem von beiden; es ist **kein** Alias für `abort`. Gültig: `{ timeout }`, `{ abort }`, `{ signal, timeout }`, `{ signal, abort }`. Ungültig: `{ abort, timeout }`. `timeout` muss eine positive Safe Integer in `1..2_147_483_647` sein.

## Typen

### RequestDefinition {#RequestDefinition}

`method`, `path`, optional `input`, `output`, `error` und `operation`. Es gibt kein `responseType`: der Struct-Kind wählt, wie ein deklarierter Body gelesen wird. Ein deklarierter `input` erfordert immer einen expliziten `builder`, auch wenn der Input bereits die Request-Shape hat. Nur Definitionen ohne `input` dürfen `builder` weglassen.

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

Die `output`-/`error`-Hälfte einer `RequestDefinition`. Fehlen beide, wird der Body nie gelesen.

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

Im Erfolgsfall trägt der dritte Slot nur dann `body`, wenn `output` deklariert war. Im Fehlerfall ist er
`undefined` — der Fault hält schon alle Response-Metadaten, die es gab.

### HttpRequest {#HttpRequest}

Normalisierter Outgoing-Request: `method`, `endpoint`, `headers`, `body`, `abort`, `operation`, Progress-Hooks, `baseEndpoint`, `queryString` und `queryParams`. Interceptors sehen `queryParams` als `new URLSearchParams(queryString)`. Ein Builder, der `URLSearchParams` zurückgibt, reicht genau diese Instanz durch. `responseType` und `errorResponseType` sind readonly: sie werden aus den Struct-Kinds von `output` und `error` des Endpunkts abgeleitet und dürfen nicht geändert werden.

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

Response-Metadaten, verfügbar sobald eine Response den Client erreicht hat. Sie tragen **kein** `body`: einen Body
gibt es erst, wenn ein deklarierter Struct einen dekodiert hat.

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

Eine Response, deren Body gegen den deklarierten Struct dekodiert wurde. Diesen Typ in der Hand zu haben ist der Beweis, dass
dekodiert wurde — deshalb meldet ein Decode-Failure `HttpMeta` allein.

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

Die Wire-Shape, die Transports produzieren und Interceptors sehen: `body` ist Text oder bereits geparstes JSON, kein
dekodierter Wert. Bei einer JSON-Representation ist ein String eine JSON-String-Wurzel und wird nicht noch einmal
geparst; Bytes und Blobs sind roh und werden einmal geparst. Beim Caller landet `DecodedResponse`.

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`, `total`, `lengthComputable`. Callbacks dürfen async sein. Ein Callback, der throwt, ist
`EXT_OBSERVER_FAILED`.

Siehe [HTTP-Guide](/core/http) und [Commands](/core/commands).

## RequestEndpoint {#RequestEndpoint}

Kommt von `defineRequest`. Mit Input aufrufen → `HttpCommand`.

## BuilderInput {#BuilderInput}

Geparster Endpoint-Input, den `builder` sieht. Object-Knoten tragen den Struct, der sie erzeugt hat, damit Alias-, `Date`- und `bigint`-Encoding dem Wert folgen.

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` und `HEAD` können keinen Body zurückgeben. `path` und `headers` müssen flache Scalars sein; `query` darf nesten, und ein genestetes Object braucht zur Laufzeit `withQuerySerializer`.

## HttpCommand {#HttpCommand}

Opakes Command vom Request-Builder. Gib es `client.execute`.

## UseRequestConfig {#UseRequestConfig}

Progress- und Cancellation-Felder. `HttpExecuteOptions` legt `signal` drauf.

## RequestSuccessData {#RequestSuccessData}

Aus dem deklarierten `output`-Struct inferierter Success-Body, oder `undefined`, wenn keiner deklariert ist.

## RequestErrorData {#RequestErrorData}

Aus dem deklarierten `error`-Struct inferierter Error-Body, oder `undefined`, wenn keiner deklariert ist.

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

Kommt aus dem deklarierten Struct-Kind (`string` → `text`, `blob` / `file` → `blob`, `arrayBuffer` → `arraybuffer`, alles andere → `json`). Kein Feld auf `defineRequest`.

## MakeResponseOptions {#MakeResponseOptions}

Felder für `makeResponse`: `status`, `statusText`, `url`, `headers`, `body`, `request`.
