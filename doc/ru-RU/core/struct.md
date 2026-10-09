---
title: Struct
description: Моделируй формы запроса и ответа, парси unknown и кодируй wire-тела.
---

# Struct

Моделируй запрос (и его ответы) как Structs. Типы TypeScript получаешь через `Infer`, проверки в рантайме — через `struct.parse(...)`: без throw, error-first кортеж.

## Базовая настройка

```typescript twoslash
import { defineRequest, struct, type Infer } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  active: struct.boolean(),
})

type User = Infer<typeof User>

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({
    name: struct.string(),
    email: struct.string(),
  }),
  builder: (input) => ({ body: input }),
  output: User,
})

const [parseError, user] = struct.parse(User, { id: 7, name: 'Ada', active: true })
if (!parseError) console.log(user.name)
void createUser
```

Распарсенный output держит только объявленные поля. Нет обязательного поля, неверный примитив, плохие вложенные значения, неверная длина tuple или запрещённый `null` → `StructError`, без частичного значения. Structs неизменяемы; `.optional()` и компания возвращают новый Struct.

## Required, optional, null

Присутствие и nullability — разные вещи:

| Объявление                   | Отсутствует / `undefined`                    | `null`     | Валидное значение |
| ---------------------------- | -------------------------------------------- | ---------- | ----------------- |
| `struct.string()`            | Отвергнуть                                   | Отвергнуть | Принять string    |
| `struct.string().optional()` | Принять; опустить отсутствующее поле объекта | Отвергнуть | Принять string    |
| `struct.string().null()`     | Отвергнуть                                   | Принять    | Принять string    |
| `struct.string().nullish()`  | Принять; опустить отсутствующее поле объекта | Принять    | Принять string    |
| `struct.null()`              | Отвергнуть                                   | Принять    | Отвергнуть прочее |

```typescript twoslash
import { struct } from '@defjs/core'

const Profile = struct.object({
  name: struct.string(),
  nickname: struct.string().optional(),
  biography: struct.string().null(),
  note: struct.string().nullish(),
})

const [error, profile] = struct.parse(Profile, {
  name: 'Ada',
  biography: null,
  note: undefined,
})
if (error) throw error
console.log(profile.name, profile.nickname, profile.biography, profile.note)
```

На корне optional может быть `undefined`. Внутри объекта опущенные optional/nullish поля остаются absent. Input формы запроса использует обычные поля с именами `path`, `query`, `headers` и `body`. Пометь одно `.optional()`, когда вызывающий может его опустить. Обязательное поле `body` остаётся обязательным, даже если каждое поле внутри него optional.

## Раскладка запроса

Path, query, headers и body — поля, которые возвращает builder, а не request struct. Опусти `builder`, когда у `input` уже эта форма. `struct.urlencoded(shape)` и `struct.formData(shape)` — object structs с тегом кодека. Тег бежит, только когда это значение — корень тела: ключи используют алиасы, а массивы повторяют имя поля.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createUser = defineRequest({
  method: 'POST',
  path: '/organizations/:organizationId/users',
  input: struct.object({
    path: struct.object({ organizationId: struct.string() }),
    query: struct.object({ notify: struct.boolean().optional() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
})

const command = createUser({
  path: { organizationId: 'acme' },
  query: { notify: true },
  headers: { requestId: 'request-42' },
  body: { displayName: 'Ada' },
})
void command
```

| Корень тела                                           | Уходит как        | Content type по умолчанию                         |
| ----------------------------------------------------- | ----------------- | ------------------------------------------------- |
| типизированный object, array, number, boolean, `null` | JSON-текст        | `application/json`                                |
| struct `string` или сырая string                      | текст             | `text/plain;charset=UTF-8`                        |
| `struct.urlencoded(shape)` в корне                    | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `struct.formData(shape)` в корне                      | `FormData`        | platform multipart boundary                       |
| `Blob` / `File`                                       | сам blob          | тип blob или `application/octet-stream`           |
| `ArrayBuffer` / view / stream                         | байты             | `application/octet-stream`                        |

`struct.file()` — value struct и для поля формы, и для сырого file body. WebSocket builder не может вернуть `headers` или `body`. HTTP и SSE могут. `GET` и `HEAD` — нет.

## Алиасы

`.alias(...)` отделяет логические имена от wire-имён. `struct.parse(...)` использует логические ключи. JSON и плоские request-кодеки кодируют алиасы; декодирование JSON-ответа отображает wire-ключи обратно в логические поля.

```typescript twoslash
import { struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
})

const [parseError, user] = struct.parse(User, { displayName: 'Ada' })
if (parseError) throw parseError
console.log(user.displayName)

const [wireError] = struct.parse(User, { display_name: 'Ada' })
console.log(wireError?.issues[0]?.path)
```

| Граница                                   | Поле                            |
| ----------------------------------------- | ------------------------------- |
| `struct.parse(User, ...)` и input команды | Логический `displayName`        |
| Типизированный объект, отданный builder   | Wire `display_name`             |
| Декодирование JSON / SSE / WebSocket      | Wire → логический `displayName` |
| Анонимный объект, написанный в builder    | Тот ключ, который ты написал    |

Алиасы работают на вложенных полях, массивах, объектах, unions и дискриминаторах. Держи логические имена в коде приложения; внешнее имя клади на struct один раз. Spread типизированного объекта сохраняет это кодирование. Поставить в одном объекте и логическое поле, и его wire-ключ — это `REQ_BUILD_FAILED`. Свой `JSON.stringify` значения сходит с этого пути: serializer видит логические имена.

Направляющая выбирается на каждом узле, а не только в корне. Новый объект под анонимным родителем сохраняет ключи, которые вы написали. Тот же объект под типизированным родителем использует struct этого поля.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

Если направляющая union совпадает больше чем с одной веткой, каждая ветка кодируется и сравнивается. Одинаковый wire-результат сохраняется; различие — это `REQ_BUILD_FAILED`.

Смешанное intersection, содержащее не-object часть, при разборе получает тегом конъюнкцию тегов совпавших частей; заново написанное значение смешанного intersection, которое не разбиралось, обрабатывается как анонимный объект.

## Сбои parse

`struct.parse(...)` возвращает `[null, value]` или `[StructError, undefined]`. `StructError` расширяет `Error` и открывает `issues`, плюс `format()`, `flatten()` и `prettify()`.

```typescript twoslash
import { struct, StructError } from '@defjs/core'

const User = struct.object({ id: struct.number(), name: struct.string() })
const [error, value] = struct.parse(User, { id: 'not-a-number' })

if (error) {
  console.log(error instanceof StructError)
  console.log(error.issues[0]?.code, error.issues[0]?.path)
  console.log(error.flatten().fieldErrors)
  console.log(error.format(), error.prettify())
}
void value
```

У `StructIssue` есть `code`, `expected`, `message`, `path` и `received`. `code` — это `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` или `missing_key`. Issues могут держать недоверенный input — маскируй перед логом или возвратом. `struct.parse(..., { errorMap })` переписывает сообщения issue только для этого вызова.

Валидация Struct только структурная. Нет публичных правил range, format, refinement, auth или перехода состояния. Эти проверки делай до сборки команды.

## Справка

Публичные конструкторы на `@defjs/core` (внутренности — не API фасада):

```typescript twoslash
import { struct } from '@defjs/core'

const Any = struct.any()
const ArrayOfStrings = struct.array(struct.string())
const Bytes = struct.arrayBuffer()
const BigIntValue = struct.bigint()
const BlobValue = struct.blob()
const BooleanValue = struct.boolean()
const DateValue = struct.date()
const Discriminated = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('created'), id: struct.number() }),
  struct.object({ kind: struct.literal('deleted'), id: struct.number() }),
])
const Status = struct.enum(['draft', 'published'])
const FileValue = struct.file()
const Form = struct.formData({ file: struct.file() })
const Combined = struct.intersection(struct.object({ id: struct.number() }), struct.object({ name: struct.string() }))
const Literal = struct.literal('ready')
const NullValue = struct.null()
const NumberValue = struct.number()
const ObjectValue = struct.object({ id: struct.number() })
const Union = struct.or(struct.string(), struct.number())
const RecordValue = struct.record(struct.number())
const StringValue = struct.string()
const Tuple = struct.tuple([struct.string(), struct.number()])
const Unknown = struct.unknown()
const FormUrlEncoded = struct.urlencoded({ name: struct.string() })

void [Any, ArrayOfStrings, Bytes, BigIntValue, BlobValue, BooleanValue, DateValue, Discriminated, Status, FileValue, Form, Combined]
void [Literal, NullValue, NumberValue, ObjectValue, Union, RecordValue, StringValue, Tuple, Unknown, FormUrlEncoded]
```

| Конструктор                      | Input                                                          | Выведенный output             |
| -------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| `struct.number()`                | Число, кроме `NaN`                                             | `number`, включая ±`Infinity` |
| `struct.date()`                  | `Date`, number или date string                                 | Валидный `Date`               |
| `struct.bigint()`                | `bigint` или строка, которую принимает `BigInt(...)`           | `bigint`                      |
| `struct.enum(...)`               | Объявленный string или number member                           | Этот literal union            |
| `struct.discriminatedUnion(...)` | Объект с обязательным literal-дискриминатором                  | Выбранная ветка объекта       |
| `struct.or(...)`                 | Первая подходящая ветка; кодирование проверяет неоднозначность | Union output веток            |
| `struct.intersection(...)`       | Значения, которые принимает каждый member                      | Intersection output           |
| `struct.record(value)`           | Plain object, чьи значения совпадают с `value`                 | Record распарсенных значений  |
| `struct.tuple(items)`            | Массив ровно объявленной длины                                 | Tuple фиксированной длины     |

Каждый Struct поддерживает `.alias(name)`, `.optional()`, `.null()` и `.nullish()`. `struct.discriminatedUnion` нуждается в object options с обязательным literal-дискриминатором и отвергает дубликаты.

Импортируй `struct`, `Infer`, `Struct`, `StructError` и связанные публичные типы из `@defjs/core`. Парсер — `struct.parse(...)`. Не импортируй `createObjectStruct`, символы определений, внутренности кодеков или `packages/core/src`.

Чего фасад не обещает:

- Output object/record с null prototype — не рассчитывай на методы `Object.prototype`.
- Неизвестные ключи объекта отбрасываются.
- `struct.number()` отвергает `NaN`, принимает бесконечности.
- `struct.or(...)` пробует ветки по порядку; отвергает неоднозначные кодирования, когда ветки не согласны.
- `struct.intersection(...)` парсит members в порядке объявления.
- Intersection глубоко сливает outputs членов (значения, равные по `Object.is`, и Date с тем же временем остаются, plain objects и массивы равной длины сливаются рекурсивно, любой другой конфликт — `invalid_intersection` на этом path), `unknown` / `any` ничего не добавляют, и один логический key может соответствовать нескольким wire key; конфликт возникает только когда в один и тот же wire key записываются неравные значения.
- Struct валидирует границу; он не кеширует, не авторизует и не владеет ресурсом транспорта.

## Связанные рецепты

- [POST JSON](../recipes/post-json.md)
- [GET с объявленным 404](../recipes/get-declared-404.md)
