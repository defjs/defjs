---
title: Struct
description: واجهة struct، وInfer، وStructError.
---

# Struct {#page}

ابنِ أشكال حدود السلك، حلّل القيم، واستنتج أنواع TypeScript.

## struct {#struct}

واجهة. فضّل هذه على المنشئات الداخلية.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### البدائيات والحاويات

| المساعد                                                                     | الدور                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | قيم قياسية                                                                 |
| `struct.literal(value)`                                                     | حرفي مطابق                                                                 |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                       |
| `struct.date()`                                                             | `Date`                                                                     |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | مجموعات                                                                    |
| `struct.object(shape)`                                                      | كائن؛ الحقول تقبل `.optional()` و`.null()` / `.nullable()` و`.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | اتحادات                                                                    |
| `struct.enum(values)`                                                       | قائمة سلاسل أو خريطة `{ Name: value }`                                      |

### ترميزات الجسم والقيم الثنائية

| المساعد                                        | الدور                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | struct كائن مع وسم ترميز. الوسم ينطبق فقط عندما تكون تلك القيمة جذر جسم الطلب |
| `struct.arrayBuffer()` / `blob()` / `file()`   | قيم ثنائية. كجذر جسم تُرسَل بايتات؛ وكـ `output` / `error` تختار ذلك التمثيل    |
| `struct.string()`                              | نص. كجذر جسم أو struct `string` وارد، تبقى البايتات نصًا                       |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **يُرجع** `[null, value]` أو `[StructError, undefined]`.
- `errorMap` الاختياري يعيد كتابة رسائل المشاكل لهذا التحليل فقط.
- الافتراضي يقرأ المفاتيح **المنطقية** (`displayName`). مرّر `{ aliases: true }` لتقرأ مفاتيح السلك (`display_name`) بالطريقة نفسها التي تفعلها ترميزات HTTP/JSON.

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## الأنواع

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

`StructIssue`: `path`، `code`، `expected`، `received`، `message`. `code` هو `custom` أو `invalid_enum` أو `invalid_intersection` أو `invalid_literal` أو `invalid_type` أو `invalid_union` أو `missing_key`.

انظر [دليل Struct](/core/struct).

## Struct {#Struct}

شكل قابل للتحليل: أنواع الإدخال/الإخراج مع `.optional()` و`.null()` / `.nullable()` و`.nullish()` و`.alias()`.

## StructLike {#StructLike}

أي شيء يحمل حمولة نوع `_struct`.

## StructMethods {#StructMethods}

`.alias()` و`.null()` / `.nullable()` و`.nullish()` و`.optional()`.

## ObjectStruct {#ObjectStruct}

struct بشكل كائن من `struct.object`.

## StructIssue {#StructIssue}

`path`، `code`، `expected`، `received`، `message`. `code` هو `custom` أو `invalid_enum` أو `invalid_intersection` أو `invalid_literal` أو `invalid_type` أو `invalid_union` أو `missing_key`.

## FormattedStructError {#FormattedStructError}

شجرة متداخلة `{ _errors, [key]: … }` من `StructError.format()`.

## FlattenedStructError {#FlattenedStructError}

`formErrors` مع `fieldErrors` من `StructError.flatten()`.
