---
title: Struct
description: واجهة struct، وInfer، وStructError.
---

# Struct

ابنِ أشكال البيانات عند حدود النقل، حلّل القيم، واستنتج أنواع TypeScript.

## struct

واجهة. فضّل هذه على المنشئات الداخلية.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias("display_name"),
});

function readUser() {
  const [error, user] = struct.parse(User, { id: 1, displayName: "Ada" });
  if (error) {
    console.error(error.message);
    return;
  }
  console.log(user.displayName);
}

readUser();
```

### البدائيات والحاويات

| المساعد                                                                     | الدور                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | قيم مفردة (scalar)                                                         |
| `struct.literal(value)`                                                     | حرفي مطابق                                                                 |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()` و`unknown()` ترفضان `null` و`undefined`      |
| `struct.date()`                                                             | `Date`                                                                     |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | مجموعات. يأخذ `tuple` مصفوفة واحدة: `struct.tuple([a, b])`                 |
| `struct.object(shape)`                                                      | كائن؛ الحقول تقبل `.optional()` و`.null()` / `.nullable()` و`.alias(name)` |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | اتحادات                                                                    |
| `struct.enum(values)`                                                       | قائمة سلاسل أو خريطة `{ Name: value }`؛ تقبل الخريطة قيمها لا مفاتيحها     |

### ترميزات الجسم والقيم الثنائية

| المساعد                                        | الدور                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | struct كائن مع وسم ترميز. الوسم ينطبق فقط عندما تكون تلك القيمة جذر جسم الطلب                                                                        |
| `struct.arrayBuffer()` / `blob()` / `file()`   | قيم ثنائية. كجذر جسم تُرسَل بايتات؛ وكـ `output` / `error` تختار ذلك التمثيل                                                                         |
| `struct.string()`                              | نص. كجذر جسم تبقى البايتات نصًا. والوارد في HTTP وSSE يبقى نصًا خامًا. إطار WebSocket الوارد يُحلَّل كـ JSON أولًا، فيتوقع struct السلسلة سلسلة JSON |

### struct.parse()

<ApiSignature name="struct.parse" />

- **يُرجع** `[null, value]` أو `[StructError, undefined]`، ومشكلة واحدة. تتوقف حقول الكائن عند أول حقل فاسد. يجرّب `struct.or` كل فرع، ثم يبلّغ `invalid_union`، ولا يُبقي فشل الفرع الأول.
- حقول الكائن مطلوبة ما لم تُوسَم بـ `.optional()` أو `.nullish()`. المفاتيح التي لا يصرّح بها الشكل تُحذف من النتيجة.
- `options.errorMap` الاختياري يعيد كتابة رسائل المشاكل لهذا التحليل فقط.
- الافتراضي يقرأ المفاتيح **المنطقية** (`displayName`). مرّر `{ aliases: true }` لتقرأ المفاتيح بصيغة النقل (`display_name`) بالطريقة نفسها التي تفعلها ترميزات HTTP/JSON.

## ErrorMap

<ApiSignature name="ErrorMap" />

## الأنواع

### Infer

### StructInput

### AnyStruct

### ParseResult

<ApiSignature name="Infer, StructInput, AnyStruct, ParseResult" />

### StructError

<ApiSignature name="StructError" />

`StructIssue`: `path`، `code`، `expected`، `received`، `message`. `code` هو `custom` أو `invalid_enum` أو `invalid_intersection` أو `invalid_literal` أو `invalid_type` أو `invalid_union` أو `missing_key`.

انظر [دليل Struct](/ar/docs/struct).

## STRUCT

`unique symbol` يسِم الكائنات المحلَّلة من مدخل نقطة النهاية. وهو داخلي لمرمِّز الطلبات الصادرة ويُصدَّر كنوع فقط. لا تقرأه ولا تعيّنه.

## Struct

شكل قابل للتحليل: أنواع الإدخال/الإخراج مع `.optional()` و`.null()` / `.nullable()` و`.nullish()` و`.alias()`.

## StructLike

أي شيء يحمل حمولة نوع `_struct`. انظر [`StructLike`](/ar/api/core/structlike-type).

## StructMethods

`.alias()` و`.null()` / `.nullable()` و`.nullish()` و`.optional()`.

## ObjectStruct

struct بشكل كائن من `struct.object`.

## StructIssue

`path`، `code`، `expected`، `received`، `message`. `code` هو `custom` أو `invalid_enum` أو `invalid_intersection` أو `invalid_literal` أو `invalid_type` أو `invalid_union` أو `missing_key`.

## FormattedStructError

شجرة متداخلة `{ _errors, [key]: … }` من `StructError.format()`.

## FlattenedStructError

`formErrors` مع `fieldErrors` من `StructError.flatten()`.
