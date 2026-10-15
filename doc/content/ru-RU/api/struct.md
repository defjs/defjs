---
title: Struct
description: Фасад struct, Infer и StructError.
---

# Struct

Собери формы на границе wire, распарси значения, выведи TypeScript-типы.

## struct

Фасад. Бери его, а не внутренние конструкторы.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### Примитивы и контейнеры

| Хелпер                                                                      | Роль                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Скаляры                                                                             |
| `struct.literal(value)`                                                     | Точный literal                                                                      |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()` и `unknown()` отвергают `null` и `undefined`          |
| `struct.date()`                                                             | `Date`                                                                              |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | Коллекции. `tuple` принимает один массив: `struct.tuple([a, b])`                    |
| `struct.object(shape)`                                                      | Объект; поля принимают `.optional()`, `.null()` / `.nullable()`, `.alias(name)`     |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Объединения                                                                         |
| `struct.enum(values)`                                                       | Список строк или карта `{ Name: value }`; карта принимает свои значения, а не ключи |

### Кодеки тела и бинарные значения

| Хелпер                                         | Роль                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Object struct плюс тег кодека. Тег применяется, только когда это значение — корень тела запроса       |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Бинарные значения. Как корень тела уходят байтами; как `output` / `error` выбирают эту representation |
| `struct.string()`                              | Текст. Как корень тела или входящий `string` struct байты остаются текстом                            |

### struct.parse()

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Возвращает** `[null, value]` или `[StructError, undefined]`. Разбор останавливается на первом провале, поэтому ошибка несёт один issue.
- Поля объекта обязательны, если не помечены `.optional()` или `.nullish()`. Ключи, которых нет в shape, отбрасываются из результата.
- Опциональный `errorMap` переписывает сообщения issue только для этого parse.
- По умолчанию читает **логические** ключи (`displayName`). Передай `{ aliases: true }`, чтобы читать wire-ключи (`display_name`) так же, как кодеки HTTP/JSON.

## ErrorMap

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## Типы

### Infer

### StructInput

### AnyStruct

### ParseResult

```ts
type Infer<T> = /* output type of T */
type StructInput<T> = /* input type of T */
type AnyStruct = Struct<any, any, boolean>
type ParseResult<O> = [error: null, value: O] | [error: StructError, value: undefined]
```

### StructError

```ts
class StructError extends Error {
  readonly issues: StructIssue[]
  format(): FormattedStructError
  flatten(): FlattenedStructError
  prettify(): string
}
```

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` — это `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` или `missing_key`.

См. [гайд Struct](/ru-RU/docs/struct).

## STRUCT

`unique symbol`, которым помечаются объекты, разобранные из input эндпоинта. Он внутренний для исходящего энкодера и экспортируется только как тип. Не читай и не задавай его.

## Struct

Разбираемая форма: типы input/output плюс `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Всё, у чего есть type payload `_struct`. См. [`StructLike`](/ru-RU/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

Объектная форма от `struct.object`.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` — это `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` или `missing_key`.

## FormattedStructError

Вложенное дерево `{ _errors, [key]: … }` из `StructError.format()`.

## FlattenedStructError

`formErrors` плюс `fieldErrors` из `StructError.flatten()`.
