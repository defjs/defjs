---
title: HTTP
description: defineRequest, opciones de execute y tipos de solicitud/respuesta HTTP.
---

# HTTP

Declara una solicitud tipada, construye un comando a partir del input y ejecútalo.

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`, `path`, struct `input` opcional, `builder` opcional, structs `output` y `error` opcionales, `operation` opcional.
- **Devuelve** un endpoint. Llámalo con el input para obtener un `HttpCommand`.

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

`output` es un struct para el cuerpo 2xx; `error` es un struct para todo cuerpo no-2xx. Ninguno se
indexa por estado. Omitir uno significa que ese cuerpo nunca se lee — mira
[Declarar es afirmar](/guide/design-decisions#declaration-is-an-assertion).

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

Entrada de bajo nivel que usa `client.execute`. En la app llama a `client.execute(command, options)`.

- **Devuelve** `[null, data, response]` o `[fault, undefined, undefined]`.

Un estado no-2xx siempre es `HTTP_STATUS`. Su `data` es el cuerpo `error` decodificado cuando se
declaró uno, y `undefined` en caso contrario. Al fallar, el tercer hueco de la tupla es `undefined`; el fault
lleva los metadatos de la respuesta.

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

Transporte HTTP por defecto. Se usa salvo que `withHTTPHandle` lo reemplace. Rechaza — en lugar de resolver
con una respuesta sintética — cuando ninguna respuesta llegó al cliente.

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

Construye un `HttpResponse` sin llamada de red (interceptores, tests). El estado por defecto es `0`. `ok` es
true en 2xx. El valor que devuelve pasa por la misma comprobación de media type y el mismo
struct declarado que una respuesta del cable; no hay ningún atajo de confianza.

## Opciones de execute

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

La cancelación es `abort` **o** `timeout`, no ambos. `signal` se combina con cualquiera; **no** es un alias de `abort`. Formas válidas: `{ timeout }`, `{ abort }`, `{ signal, timeout }`, `{ signal, abort }`. `{ abort, timeout }` es inválido. `timeout` debe ser un entero seguro positivo en `1..2_147_483_647`.

## Tipos

### RequestDefinition {#RequestDefinition}

`method`, `path`, `input` opcional, `builder`, `output`, `error` y `operation`. No hay `responseType`: el kind del struct elige cómo se lee un cuerpo declarado.

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

La mitad `output` / `error` de una `RequestDefinition`. Si faltan ambas, el cuerpo nunca se lee.

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

Al tener éxito, el tercer hueco lleva `body` solo si se declaró `output`. Al fallar es
`undefined`: el fault ya guarda los metadatos de respuesta que existieran.

### HttpRequest {#HttpRequest}

Solicitud saliente normalizada: `method`, `endpoint`, `headers`, `body`, `abort`, `operation`, hooks de progreso, `baseEndpoint`, `queryString` y `queryParams`. Los interceptores ven `queryParams` como `new URLSearchParams(queryString)`. Un builder que devuelve `URLSearchParams` pasa esa misma instancia. `responseType` y `errorResponseType` son readonly: se derivan de los kinds de struct `output` y `error` del endpoint y no deben cambiarse.

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

Metadatos de la respuesta, disponibles siempre que una respuesta llegó al cliente. **No** llevan `body`: un cuerpo
solo existe una vez que un struct declarado decodificó uno.

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

Una respuesta cuyo cuerpo se decodificó contra el struct declarado. Tener este tipo en la mano es la prueba de que
la decodificación ocurrió, y por eso un fallo de decodificación reporta solo `HttpMeta`.

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

La forma de cable que producen los transportes y ven los interceptores: `body` es texto o JSON ya
parseado, no un valor decodificado. En una representación JSON, un string es una raíz string JSON y no
se vuelve a parsear; los bytes y los blobs son crudos y se parsean una vez. Lo que llega a quien llama es `DecodedResponse`.

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`, `total`, `lengthComputable`. Los callbacks pueden ser async. Un callback que lanza es
`EXT_OBSERVER_FAILED`.

Mira la [guía de HTTP](/core/http) y [Comandos](/core/commands).

## RequestEndpoint {#RequestEndpoint}

Lo devuelve `defineRequest`. Llámalo con input y sale un `HttpCommand`.

## BuilderInput {#BuilderInput}

Input del endpoint ya parseado que ve `builder`. Los nodos objeto llevan el struct que los produjo, así que el alias y la codificación de `Date` y `bigint` siguen al valor.

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` y `HEAD` no pueden devolver un body. `path` y `headers` deben ser escalares planos; `query` puede anidar, y un objeto anidado necesita `withQuerySerializer` en runtime.

## HttpCommand {#HttpCommand}

Command opaco de un request builder. Pásaselo a `client.execute`.

## UseRequestConfig {#UseRequestConfig}

Campos de progreso y cancelación. `HttpExecuteOptions` añade `signal`.

## RequestSuccessData {#RequestSuccessData}

Cuerpo de éxito inferido del struct `output` declarado, o `undefined` si no hay ninguno.

## RequestErrorData {#RequestErrorData}

Cuerpo de error inferido del struct `error` declarado, o `undefined` si no hay ninguno.

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

Se elige a partir del kind del struct declarado (`string` → `text`, `blob` / `file` → `blob`, `arrayBuffer` → `arraybuffer`, todo lo demás → `json`). No es un campo de `defineRequest`.

## MakeResponseOptions {#MakeResponseOptions}

Campos para `makeResponse`: `status`, `statusText`, `url`, `headers`, `body`, `request`.
