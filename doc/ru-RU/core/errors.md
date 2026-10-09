---
title: Ошибки
description: Ветвись по одному замкнутому набору кодов fault для 404, timeout, нечитаемых тел и сбоев транспорта.
---

# Ошибки

404, timeout или нечитаемое тело обрабатывай, читая error-first кортеж, а не ловя throw. `Fault` — нативный `Error` (`instanceof Error` истинен), размеченный одним полем: `code`.

`kind` нет. Класс провала — отрезок до первого `_` в коде, так что `NET_TIMEOUT` — провал `NET`, а `RES_STRUCT_MISMATCH` — провал `RES`. Префикс читай для грубой сортировки, весь код — для точного случая.

## Базовая настройка

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

Раз набор замкнут, `switch` по `code` исчерпывающий:

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

## Стабильные коды

| Класс  | Коды                                                                   | Кому меняться                                      |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------- |
| `HTTP` | `HTTP_STATUS`                                                          | Пир ответил non-2xx; обрабатывай как бизнес-логику |
| `REQ`  | `REQ_INPUT_INVALID`, `REQ_OPTIONS_INVALID`, `REQ_BUILD_FAILED`         | Вызов или объявление эндпоинта                     |
| `NET`  | `NET_ABORTED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `NET_BODY_INCOMPLETE` | Никому, или ретрай                                 |
| `RES`  | `RES_MEDIA_TYPE_INVALID`, `RES_DECODE_FAILED`, `RES_STRUCT_MISMATCH`   | Объявление и пир надо свести                       |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`     | Код, который ты повесил на pipeline                |
| `CAP`  | `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`                            | Объявленный лимит или темп consumer                |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | Рантайм хоста                                      |

Набор замкнут нарочно: именно это держит `switch` исчерпывающим. Расширения сообщают свою деталь через `cause`, а не через новый код.

### Поля по форме

| Код           | `status` | `response`                                                      | `data`                                      |
| ------------- | -------- | --------------------------------------------------------------- | ------------------------------------------- |
| `HTTP_STATUS` | Всегда   | Всегда; `body` есть, только если `error` объявлен и декодирован | Декодированное тело `error` или `undefined` |
| `RES_*`       | Всегда   | Всегда, только метаданные — **нет `body`**                      | Нет                                         |
| Всё остальное | Нет      | Только там, где у транспорта уже были метаданные                | Нет                                         |

`cause` несёт нижележащее значение: `StructError` при расхождении struct, провал парсера при нечитаемой representation, что бы ни бросило расширение.

## Формы кортежа по транспортам

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

При HTTP-провале третий слот — `undefined`: fault уже несёт те метаданные ответа, что были. Это важно, потому что fault — то, что ты отдаёшь handler’у, логируешь или пробрасываешь, так что метаданные должны ехать _вместе_ с ним, а не рядом.

У SSE и WebSocket третий слот — снимок старта, который может быть даже когда старт упал. После возврата handle или session поздние провалы живут на его lifecycle — осевший кортеж старта они не переписывают.

## Как читается тело

`ok` — единственная развилка, и декодирует всегда одна сторона. `output` читает тело 2xx; `error` читает всё остальное. Пропустить сторону значит, что это тело не читают.

| Ситуация                                              | Исход                                                   |
| ----------------------------------------------------- | ------------------------------------------------------- |
| 2xx, `output` объявлен, тело декодируется             | Успех; `data` и `response.body` типизированы            |
| 2xx, `output` опущен                                  | Успех; `data` — `undefined`, у response нет `body`      |
| Non-2xx, `error` объявлен, тело декодируется          | `HTTP_STATUS` с типизированным `data`                   |
| Non-2xx, `error` опущен                               | `HTTP_STATUS` с `data: undefined`                       |
| Media type не тот, что нужен representation           | `RES_MEDIA_TYPE_INVALID`, сообщается **до** чтения тела |
| Байты — не эта representation                         | `RES_DECODE_FAILED`                                     |
| Значение — не этот struct                             | `RES_STRUCT_MISMATCH`                                   |
| Нечитаемое тело на стороне, которую ты **не** объявил | Игнорируется целиком — см. ниже                         |

Последнюю строку стоит помнить. Если ты объявил `output`, но не `error`, 500 с битым JSON-телом сообщается как `HTTP_STATUS` со `status: 500`. Ты сказал, что тела ошибок тебе не важны, и это включает неважность того, что одно не прочиталось.

Декодирование происходит один раз, после цепочки interceptor. Ответ, который interceptor собрал через `makeResponse(...)`, проходит ту же проверку media type и тот же struct, что и пришедший с провода.

`HttpResponse.ok` значит только `200 <= status < 300`. Провал транспорта — это fault, никогда не response: status-0 ответа, стоящего вместо него, нет.

## Сужение объединения тел ошибок

Один struct `error` покрывает каждый non-2xx статус, так что при разных формах объявляй union. Что потом можно делать с `fault.data`, целиком зависит от того, как ты объявил этот union — библиотека отдаёт ровно тот тип, который ты попросил.

`struct.or(...)` даёт обычный union, который TypeScript сам не сужает. Проверь нужное поле:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` сужает по полю, которое тело реально несёт — удобная форма, когда API уже тегирует ошибки:

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

Когда API кладёт status **внутрь** тела, дискриминируй по нему, а не по `fault.status`:

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

Последнюю форму стоит предпочитать, где API это поддерживает. `fault.status` — число HTTP-слоя, которое прокси, gateway или CDN может переписать; `data.status` декодирован из тела, которое утвердил твой struct `error`, так что дотянуться до него — доказательство, что его произвёл бэкенд.

Union без дискриминатора, который не сужается, — свойство объявления, не библиотеки: она отдаёт тип, который ты объявил. Добавь дискриминатор в struct, если он нужен.

## Старт и после открытия

SSE валидирует status, `text/event-stream` и наличие тела до резолва handle. Non-2xx → `HTTP_STATUS`. Неверный media type → `RES_MEDIA_TYPE_INVALID`. Нет тела → `RES_DECODE_FAILED`. Снимок открытия всё ещё может лечь в третий слот кортежа.

Старт WebSocket покрывает handshake плюс первое физическое open. Провал конструктора, close до open, timeout или cancel — всё это стартовый кортеж. Снимок connection может существовать, даже если сокет так и не дошёл до `open`.

| Транспорт | После старта                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSE       | Iterator reject’ит на фатальной ошибке; `stream.closed` резолвится с `kind: 'error'` и `code` fault                                                          |
| WebSocket | `onRuntimeError` для провалов message/queue/heartbeat; `receive` падает на терминальных ошибках; `session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP      | Promise execute оседает один раз. Код interceptor и колбэка всё ещё может бросить вне нормализации кортежа                                                   |

`NET_ABORTED` / `NET_TIMEOUT` описывают, что увидел вызывающий на старте. Возвращённый стрим или сессию ты всё равно закрываешь и ждёшь терминальный promise.

## Логирование нативного Error и cause

Faults — экземпляры нативного `Error`, так что диагностический адаптер не нужен. `String(fault)` даёт стабильную нативную форму `DefjsFault: <message>`. `code` и поля варианта — `status`, `response`, `data` — остаются перечислимыми для структурного лога; `name` и нативная цепочка `cause` не перечислимы.

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

Сузь `fault.cause instanceof StructError`, прежде чем звать `format()`, `flatten()` или `prettify()`. Эти helper’ы живут на cause Struct; на fault они не копируются. Не строй control flow на разборе `message` или `String(fault)` — контракт это `code` и проверенный `status`.

## Справка

| Ветка                 | Проверка control flow              | Полезные стабильные поля                    | Обычно нет / чувствительно          |
| --------------------- | ---------------------------------- | ------------------------------------------- | ----------------------------------- |
| Политика HTTP status  | `fault.code === 'HTTP_STATUS'`     | `fault.status`, проверенный `fault.data`    | Тело, заголовки, URL, `cause`       |
| Отмена вызывающим     | `fault.code === 'NET_ABORTED'`     | `code`                                      | Причина abort и стек                |
| Timeout               | `fault.code === 'NET_TIMEOUT'`     | `code`                                      | URL запроса и нижележащий cause     |
| Контракт сломался     | `fault.code.startsWith('RES_')`    | `code`, проверенный `fault.response.status` | Issues struct, тело, значения input |
| Бросил твой код       | `fault.code.startsWith('EXT_')`    | `code`, `cause`                             | Что приложило расширение            |
| Runtime стрима/сессии | `stream.closed` / `session.closed` | Терминальные `kind` и `code`                | Payload событий, кадры, cause       |

Считай чувствительными `cause`, `data`, заголовки и тела ответа, URL, issues Struct, значения input и стеки. Консервативная сводка:

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`, `createPreflightFault`, `createDecodeFault`, `createHttpStatusFault` и `createUndecodedHttpStatusFault` собирают эти нативные значения Error. Обычные провалы запроса всё равно возвращают их в кортеже; их не бросают лишь потому, что они наследуют поведение нативного Error. `ERR_ABORTED` и `ERR_TIMEOUT` — общие cause, которые узнаёт нормализатор транспорта.

## Связанные рецепты

- [GET с объявленным 404](../recipes/get-declared-404.md)
- [Отменить HTTP-вызов](../recipes/cancel-http.md)
