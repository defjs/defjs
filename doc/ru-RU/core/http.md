---
title: HTTP
description: Опиши запрос, выполни, ветвись по status и отмени через signal или timeout.
---

# HTTP

Опиши → выполни → ветвись по кортежу → отмени, когда экран ушёл. Весь HTTP-цикл — это оно.

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

const [error, data, response] = await client.execute(getUser({ id: 7 }))
if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (!error) {
  console.log(data.name, response.status)
}
```

## Собери URL

`withEndpoint(...)` нужен валидный абсолютный URL. Pathname эндпоинта остаётся директорией; query и hash отбрасываются до резолва команды.

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({ path: { id: input.id }, query: { fields: input.fields } }),
})

const command = getUser({ id: 'a/b', fields: 'name' })
void client.execute(command)
// → https://api.example.com/v1/users/a%2Fb?fields=name
```

Placeholder’ы path — сырые скаляры, кодируются ровно один раз. Пустые значения и `.` / `..` отвергаются. Слэши, `?`, `#`, `%`, пробелы и Unicode в одном placeholder остаются одним закодированным сегментом — не прекодируй.

Path определения не может содержать `?` или `#` и не может быть absolute или protocol-relative. Encoder query по умолчанию принимает скаляры и массивы скаляров (массивы повторяют ключ). Вложенный объект падает с `REQ_BUILD_FAILED`, если у клиента нет `withQuerySerializer(...)`. `null` в `path`, `query` или `headers` падает так же. `undefined` опускается.

## Разложи input

Struct кодирует значение. Builder его раскладывает. Опусти `builder`, когда `input` уже `{ path?, query?, headers?, body? }`.

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})

const [error, user] = await client.execute(
  updateUser({
    path: { id: 7 },
    headers: { requestId: 'request-42' },
    body: { displayName: 'Ada' },
  }),
)
if (error) console.error(error.code)
else console.log(user.id)
```

Это тело — `{"display_name":"Ada"}` с `application/json`. Wire-имя заголовка — `x-request-id`. Вызывающие и распарсенные результаты держат `displayName`.

Лучше провести типизированное значение, чем выписывать wire-ключи. Алиас объявляется один раз на поле и работает в обе стороны: `output` / `error` / события / входящие кадры декодируют `display_name` в `displayName`, а `body: input.order` переписывает всё дерево. Один и тот же struct `User` может быть телом create и output get. Ключ, написанный руками, — исключение: родительский объект анонимный, поэтому алиас не бежит.

| Выражение builder                               | На проводе                                                      |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `body: input.profile`                           | Типизированный объект: алиас и кодирование `Date` / `bigint`    |
| `body: { profile: input.profile }`              | Внешние ключи литеральны, внутренний объект всё ещё типизирован |
| `body: { ...input.profile, role: 'admin' }`     | Spread сохраняет struct; лишний ключ литерален                  |
| `body: { name: input.profile.displayName }`     | Анонимный родитель: алиас не применяется                        |
| `query: input.query` / `headers: input.headers` | Типизированные плоские объекты: алиас становится wire-ключом    |

Spread типизированного объекта и одновременная установка его wire-ключа (`display_name` рядом с `displayName`) — это `REQ_BUILD_FAILED`. Вложенный объект в `path` или `headers` падает так же.

Направляющая выбирается на каждом узле, а не только в корне. Новый объект под анонимным родителем сохраняет ключи, которые вы написали. Тот же объект под типизированным родителем использует struct этого поля.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

Если направляющая union совпадает больше чем с одной веткой, каждая ветка кодируется и сравнивается. Одинаковый wire-результат сохраняется; различие — это `REQ_BUILD_FAILED`.

Смешанное intersection, содержащее не-object часть, при разборе получает тегом конъюнкцию тегов совпавших частей; заново написанное значение смешанного intersection, которое не разбиралось, обрабатывается как анонимный объект.

### Query

Вложенная форма query (`a[b]`, `a.b`, списки через запятую) — соглашение бэкенда, поэтому хук живёт на клиенте:

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

Здесь `query` — уже закодированный wire-объект. Алиасы уже применены, так что serializer вроде `qs` их не теряет. Возвращённая строка — это query-строка. Defjs от `qs` не зависит.

Без serializer массивы повторяют ключи, а вложенный объект — это `REQ_BUILD_FAILED`. `URLSearchParams`, возвращённый из builder, берётся как есть и serializer пропускает. Serializer не зовут, когда query нет. Дальше interceptors видят `queryParams` как `new URLSearchParams(queryString)`.

### Body

Побеждает первое совпадение:

| Значение `body`                                                           | Уходит как                                                                  | Content type по умолчанию                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| опущено / `undefined`                                                     | тела нет                                                                    | —                                                          |
| типизированный объект, у корня которого кодек `urlencoded` или `formData` | `URLSearchParams` / `FormData`; ключи — wire-имена; массивы повторяют ключи | form type / platform boundary                              |
| `FormData`, `URLSearchParams`                                             | как есть                                                                    | то же; Defjs снимает протухший `Content-Type` у `FormData` |
| `Blob` / `File`                                                           | как есть                                                                    | `blob.type` или `application/octet-stream`                 |
| `ArrayBuffer`, `TypedArray`, `DataView`                                   | как есть                                                                    | `application/octet-stream`                                 |
| `ReadableStream`                                                          | стримом (`duplex: 'half'`, если рантайм позволяет)                          | `application/octet-stream`                                 |
| `string`                                                                  | как есть                                                                    | `text/plain;charset=UTF-8`                                 |
| object, array, number, boolean, `null`                                    | кодируется, потом `JSON.stringify`                                          | `application/json`                                         |

Поставь `content-type` в `headers`, чтобы перекрыть дефолт. Тег кодека применяется только в корне тела: `body: { meta: input.form }` — это JSON, а поля формы — обычные JSON-поля. Строка — сырой текст; JSON-строка вроде `"abc"` нуждается в `JSON.stringify` плюс `application/json`. Поля `undefined` опускаются; `nullable` поле, отправленное как `null`, — это JSON `null`.

`GET` и `HEAD` не могут вернуть тело — это ошибка типа. WebSocket builder не может вернуть `headers` или `body`.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const login = defineRequest({
  method: 'POST',
  path: '/login',
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias('username'),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
})

const upload = defineRequest({
  method: 'POST',
  path: '/files/:id',
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData()
    input.photos.forEach((photo, index) => body.append('photo', photo, `photo-${index}.jpg`))
    return { path: { id: input.id }, body }
  },
})

void login
void upload
```

`JSON.stringify`, `qs` или protobuf, которые гоняешь сам, видят логические имена. На этом пути алиас не применяется. Публичного `struct.encode` нет.

Builder может ветвиться по настоящему input и возвращать разное тело на случай (JSON-записи, `File` или `URLSearchParams`). Нативные `Headers` тоже проходят насквозь и заново не кодируются.

## Как читается тело

`output` — один Struct для тела 2xx; `error` — один Struct для всего остального. Kind struct выбирает representation: `string` — сырой текст, `blob` / `file` — blob, `arrayBuffer` — байты, любой другой kind — JSON. Если не объявлена ни одна сторона, тело не читают.

Порядок:

1. `ok` выбирает сторону: `output` для 2xx, `error` для всего остального. Никогда обе.
2. Для этой стороны ничего не объявлено → тело не читают. 2xx успешен с `data === undefined`; non-2xx — это `HTTP_STATUS` с `data === undefined`. Нечитаемое тело на стороне, которую ты не объявил, игнорируется, включая сам факт, что его не прочитали.
3. Media type проверяется **до** чтения тела. Несовпадение — `RES_MEDIA_TYPE_INVALID`, ничего не парсится и не декодируется.
4. Читается representation. Провал — `RES_DECODE_FAILED`. JSON от транспорта парсится один раз: строка в
   этом значении — JSON-строка как корень и повторно не парсится; байты и blob'ы сырые и парсятся один раз.
5. Struct парсит значение. Провал — `RES_STRUCT_MISMATCH`.
6. 2xx → результат и типизированный `response.body`; non-2xx → типизированный `data` на `HTTP_STATUS`.

Декодирование происходит один раз, после цепочки interceptor, так что ответ, который interceptor собрал через `makeResponse(...)`, читается ровно как пришедший с провода. Для JSON-представления строковый body — это JSON-строка как корень.

Успешный ответ — это `DecodedResponse<T>`: `url`, `status`, `statusText`, `headers`, `ok` и типизированный `body`. Где ничего не декодировали, получаешь `HttpMeta` — те же поля без `body`. `ok` значит только `200 <= status < 300`. Ни то ни другое не нативный `Response`. Провал транспорта — это fault, так что status-0 ответа, стоящего вместо него, нет.

## Отмени работу {#cancel-the-work}

Опции выполнения берут `signal` плюс либо `abort`, либо `timeout`. **`abort` и `timeout` взаимоисключающие.** `signal` сочетается с любым из них.

```ts
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const command = defineRequest({ method: 'GET', path: '/report' })()
const controller = new AbortController()
const pending = client.execute(command, { signal: controller.signal, timeout: 5_000 })

controller.abort('screen closed')
const [error] = await pending
if (error?.code === 'NET_ABORTED') {
  console.log('caller cancellation')
}
```

`timeout` — положительное safe integer в `1..2_147_483_647`. Узнанная отмена → `NET_ABORTED`; timeout выполнения → `NET_TIMEOUT`; `throw` interceptor → `EXT_INTERCEPTOR_FAILED`; прочие сбои Fetch → `NET_UNREACHABLE`. Отмена после того, как сервер принял запись, **не** доказывает, что запись откатилась.

## Credentials и XSRF

`withCredentials(true)` ставит Fetch `credentials: 'include'` для HTTP и SSE. Он не создаёт `Authorization` и не настраивает auth WebSocket. `false` оставляет credentials незаданными.

`withXSRF(...)` — только HTTP. По умолчанию: `cookieName: 'XSRF-TOKEN'`, `headerName: 'X-XSRF-TOKEN'`. Заголовок инжектится только для non-safe методов, только если вызывающий его ещё не поставил, и только для same-origin запросов браузера. Пропускает `GET`, `HEAD`, `OPTIONS`, `TRACE`. Вне браузера передай синхронный request-scoped `tokenProvider`, если инъекция нужна.

Держи credentials, XSRF-токены и query-строки подальше от обычных логов. Не используй query params как общий канал для credentials.

## Progress и граница Fetch

`onDownloadProgress` бежит, пока читается объявленное тело ответа. `lengthComputable` истинен только при положительном `Content-Length`. Нет struct для этой стороны → тело не читают → нет progress чтения тела.

`onUploadProgress` смотрит тело запроса `ReadableStream<Uint8Array>`, пока его читает Fetch. JSON или text тело — не этот стрим: верни из builder `file.stream()` (или другой `ReadableStream`), когда нужен upload progress. Транспорт сообщает capability error, когда рантайм не умеет слать стримовое тело.

`fetchHandler(httpRequest, fetchImpl?)` — нижняя граница Fetch: собирает нативный `Request`, зовёт Fetch, читает representation, возвращает `HttpResponse`. Он **не** валидирует input команды, не диспатчит `output` и не гоняет interceptors. Годится для тестов подставленного транспорта — не замена `client.execute`.

## Пределы replay

Defjs **не** auto-retry HTTP. Ретрай чтения всё равно нуждается в проверенной политике timeout/сети/дубликатов. Ретрай мутации нуждается в воспроизводимых байтах, поддержке сервера, ключе идемпотентности, привязанном к auth scope + байтам запроса, и политике дубликатов на приёмнике.

Граница client/command/Fetch не может знать, закоммитилась ли упавшая запись. Решения о replay держи в приложении или в проверенном interceptor. Interceptors могут short-circuit или заменить низкоуровневый запрос; итоговые status и тело всё равно должны удовлетворять контракту команды.

## Связанные рецепты

- [GET с объявленным 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Отменить HTTP-вызов](../recipes/cancel-http.md)
- [Тест с локальным Fetch handle](../recipes/test-with-handle.md)
