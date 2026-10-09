---
title: Struct
description: Фасад struct, Infer и StructError.
---

# Struct {#page}

Собери формы на границе wire, распарси значения, выведи TypeScript-типы.

## struct {#struct}

Фасад. Бери его, а не внутренние конструкторы.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### Примитивы и контейнеры

| Хелпер                                                                      | Роль                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Скаляры                                                                         |
| `struct.literal(value)`                                                     | Точный literal                                                                  |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                            |
| `struct.date()`                                                             | `Date`                                                                          |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | Коллекции                                                                       |
| `struct.object(shape)`                                                      | Объект; поля принимают `.optional()`, `.null()` / `.nullable()`, `.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                          |
| `struct.enum(values)`                                                       | Список строк или карта `{ Name: value }`                                        |

### Кодеки тела и бинарные значения

| Хелпер                                         | Роль                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Object struct плюс тег кодека. Тег применяется, только когда это значение — корень тела запроса       |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Бинарные значения. Как корень тела уходят байтами; как `output` / `error` выбирают эту representation |
| `struct.string()`                              | Текст. Как корень тела или входящий `string` struct байты остаются текстом                            |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **Возвращает** `[null, value]` или `[StructError, undefined]`.
- Опциональный `errorMap` переписывает сообщения issue только для этого parse.
- По умолчанию читает **логические** ключи (`displayName`). Передай `{ aliases: true }`, чтобы читать wire-ключи (`display_name`) так же, как кодеки HTTP/JSON.

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## Типы

### Infer {#Infer}

### StructInput {#StructInput}

### AnyStruct {#AnyStruct}

### ParseResult {#ParseResult}

```ts
type Infer<T> = /* output type of T */
type StructInput<T> = /* input type of T */
type AnyStruct = Struct<any, any, boolean>
type ParseResult<O> = [error: null, value: O] | [error: StructError, value: undefined]
```

### StructError {#StructError}

```ts
class StructError extends Error {
  readonly issues: StructIssue[]
  format(): FormattedStructError
  flatten(): FlattenedStructError
  prettify(): string
}
```

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` — это `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` или `missing_key`.

См. [гайд Struct](/core/struct).

## Struct {#Struct}

Разбираемая форма: типы input/output плюс `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike {#StructLike}

Всё, у чего есть type payload `_struct`.

## StructMethods {#StructMethods}

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct {#ObjectStruct}

Объектная форма от `struct.object`.

## StructIssue {#StructIssue}

`path`, `code`, `expected`, `received`, `message`. `code` — это `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` или `missing_key`.

## FormattedStructError {#FormattedStructError}

Вложенное дерево `{ _errors, [key]: … }` из `StructError.format()`.

## FlattenedStructError {#FlattenedStructError}

`formErrors` плюс `fieldErrors` из `StructError.flatten()`.
