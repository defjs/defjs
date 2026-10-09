---
title: HTTP
description: defineRequest, опции execute и типы HTTP request/response.
---

# HTTP

Объяви типизированный запрос, собери команду из input, выполни.

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`, `path`, необязательный `input` struct, необязательный `builder`, необязательные `output` и `error` structs, необязательный `operation`.
- **Возвращает** эндпоинт. Вызови его с input — получишь `HttpCommand`.

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

`output` — один struct для тела 2xx; `error` — один struct для каждого non-2xx тела. Ни то ни другое не ключуется по status. Пропустить одну сторону значит, что это тело не читают — см. [Объявление — это утверждение](/guide/design-decisions#declaration-is-an-assertion).

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

Низкоуровневый вход, которым пользуется `client.execute`. Прикладной код должен звать `client.execute(command, options)`.

- **Возвращает** `[null, data, response]` или `[fault, undefined, undefined]`.

Любой non-2xx статус — это `HTTP_STATUS`. Его `data` — декодированное тело `error`, если оно было объявлено, иначе `undefined`. При провале третий слот кортежа — `undefined`; метаданные ответа несёт fault.

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

HTTP-транспорт по умолчанию. Используется, пока `withHTTPHandle` его не подменит. Он reject’ит — а не резолвится синтетическим ответом — когда до клиента не доехал ни один response.

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

Собери `HttpResponse` без сетевого вызова (interceptors, тесты). Status по умолчанию — `0`. `ok` истинен для 2xx. Возвращённое значение проходит ту же проверку media type и тот же объявленный struct, что и ответ с провода; доверенного short-circuit нет.

## Опции execute

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

Отмена — это `abort` **или** `timeout`, не оба. `signal` сочетается с любым из них; это **не** алиас `abort`. Допустимые формы: `{ timeout }`, `{ abort }`, `{ signal, timeout }`, `{ signal, abort }`. `{ abort, timeout }` невалиден. `timeout` — положительное safe integer в `1..2_147_483_647`.

## Типы

### RequestDefinition {#RequestDefinition}

`method`, `path`, необязательные `input`, `builder`, `output`, `error` и `operation`. `responseType` нет: kind struct выбирает, как читать объявленное тело.

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

Половина `output` / `error` у `RequestDefinition`. Если нет обоих, тело не читают.

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

При успехе третий слот несёт `body`, только если был объявлен `output`. При провале он `undefined` — fault уже держит те метаданные ответа, что были.

### HttpRequest {#HttpRequest}

Нормализованный исходящий запрос: `method`, `endpoint`, `headers`, `body`, `abort`, `operation`, progress hooks, `baseEndpoint`, `queryString` и `queryParams`. Interceptors видят `queryParams` как `new URLSearchParams(queryString)`. Builder, который возвращает `URLSearchParams`, протаскивает этот же экземпляр. `responseType` и `errorResponseType` только для чтения: они выводятся из kind struct'ов `output` и `error` эндпоинта, и их нельзя менять.

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

Метаданные ответа, доступные, когда response доехал до клиента. `body` тут **нет**: тело существует, только когда объявленный struct его декодировал.

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

Ответ, чьё тело декодировалось против объявленного struct. Держать этот тип — доказательство, что декодирование случилось; поэтому провал decode сообщает один `HttpMeta`.

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

Wire-форма, которую производят транспорты и видят interceptors: `body` — текст или уже распарсенный JSON, не декодированное значение. Для JSON-представления строка — это JSON-строка как корень и повторно не парсится; байты и blob'ы сырые и парсятся один раз. До вызывающего доходит `DecodedResponse`.

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`, `total`, `lengthComputable`. Колбэки могут быть async. Колбэк, который бросает, — это `EXT_OBSERVER_FAILED`.

См. [гайд HTTP](/core/http) и [Команды](/core/commands).

## RequestEndpoint {#RequestEndpoint}

То, что возвращает `defineRequest`. Вызови с input — получишь `HttpCommand`.

## BuilderInput {#BuilderInput}

Распарсенный input эндпоинта, который видит `builder`. Узлы-объекты несут struct, который их произвёл, так что кодирование алиаса, `Date` и `bigint` следует за значением.

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` и `HEAD` не могут вернуть тело. `path` и `headers` должны быть плоскими скалярами; `query` может быть вложенным, и вложенному объекту в рантайме нужен `withQuerySerializer`.

## HttpCommand {#HttpCommand}

Непрозрачная команда от request builder. Отдай в `client.execute`.

## UseRequestConfig {#UseRequestConfig}

Поля progress и отмены. `HttpExecuteOptions` добавляет `signal`.

## RequestSuccessData {#RequestSuccessData}

Выведенное success-тело из объявленного struct `output`, или `undefined`, если его нет.

## RequestErrorData {#RequestErrorData}

Выведенное error-тело из объявленного struct `error`, или `undefined`, если его нет.

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

Выбирается по kind объявленного struct (`string` → `text`, `blob` / `file` → `blob`, `arrayBuffer` → `arraybuffer`, всё остальное → `json`). Это не поле `defineRequest`.

## MakeResponseOptions {#MakeResponseOptions}

Поля для `makeResponse`: `status`, `statusText`, `url`, `headers`, `body`, `request`.
