---
title: Struct
description: نمذج أشكال الطلب والاستجابة، حلّل المجهول، ورمّز أجسام السلك.
---

# Struct

نمذج طلبًا (واستجاباته) كـ Structs. تحصل على أنواع TypeScript عبر `Infer`، وفحوص وقت التشغيل عبر `struct.parse(...)` — بلا رمي، tuple يضع الخطأ أولاً.

## الإعداد الأساسي

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

المخرج المحلَّل يحتفظ فقط بالحقول المعلَنة. حقول مطلوبة مفقودة، أو بدائيات خاطئة، أو قيم متداخلة سيئة، أو طول tuple خاطئ، أو `null` غير مسموح → `StructError`، بلا قيمة جزئية. Structs غير قابلة للتغيير؛ `.optional()` وأصدقاؤها تُرجع Struct جديدًا.

## مطلوب، اختياري، null

الوجود والقابلية لـ null منفصلان:

| الإعلان                        | مفقود / `undefined`          | `null` | قيمة صالحة       |
| ---------------------------- | ---------------------------- | ------ | ---------------- |
| `struct.string()`            | ارفض                         | ارفض   | اقبل سلسلة       |
| `struct.string().optional()` | اقبل؛ احذف حقل الكائن الغائب | ارفض   | اقبل سلسلة       |
| `struct.string().null()`     | ارفض                         | اقبل   | اقبل سلسلة       |
| `struct.string().nullish()`  | اقبل؛ احذف حقل الكائن الغائب | اقبل   | اقبل سلسلة       |
| `struct.null()`              | ارفض                         | اقبل   | ارفض القيم الأخرى |

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

في الجذر، الاختياري يمكن أن يكون `undefined`. داخل كائن، الحقول الاختيارية/nullish المحذوفة تبقى غائبة. المدخل بشكل الطلب يستخدم حقولًا عادية باسم `path` و`query` و`headers` و`body`. علّم أحدها `.optional()` عندما يجوز للمستدعي حذفه. حقل `body` المطلوب يبقى مطلوبًا حتى لو كان كل حقل داخله اختياريًا.

## وضع الطلب

المسار والاستعلام والرؤوس والجسم حقول يُرجعها الـ builder، وليست struct طلب. عند التصريح بـ `input`، يجب دائمًا توفير `builder` صريح، حتى لو كان المدخل يطابق شكل الطلب أصلًا. يمكن حذف `builder` فقط من التعريفات التي لا تصرّح بـ `input`. `struct.urlencoded(shape)` و`struct.formData(shape)` هما struct كائن مع وسم ترميز. الوسم يعمل فقط عندما تكون تلك القيمة جذر الجسم: المفاتيح تستخدم الأسماء المستعارة، والمصفوفات تكرر اسم الحقل.

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
  builder: (input) => ({
    path: input.path,
    query: input.query,
    headers: input.headers,
    body: input.body,
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

| جذر الجسم                                   | يُرسَل كـ           | نوع المحتوى الافتراضي                              |
| ------------------------------------------- | ----------------- | ------------------------------------------------- |
| كائن مُنوَّع، مصفوفة، عدد، قيمة منطقية، `null` | نص JSON           | `application/json`                                |
| struct `string` أو سلسلة خام                | نص                | `text/plain;charset=UTF-8`                        |
| `struct.urlencoded(shape)` عند الجذر        | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `struct.formData(shape)` عند الجذر          | `FormData`        | حد multipart للمنصة                               |
| `Blob` / `File`                             | الـ blob          | نوع الـ blob أو `application/octet-stream`        |
| `ArrayBuffer` / عرض / تدفق                  | بايتات            | `application/octet-stream`                        |

`struct.file()` هو struct قيمة لحقل نموذج ولجسم ملف خام. بنّاؤو WebSocket لا يمكنهم إرجاع `headers` أو `body`. HTTP وSSE يستطيعان. `GET` و`HEAD` لا يستطيعان.

## الأسماء المستعارة

`.alias(...)` يفصل الأسماء المنطقية عن أسماء السلك. `struct.parse(...)` يستخدم المفاتيح المنطقية. ترميزات JSON والطلب المسطّح ترمّز الأسماء المستعارة؛ وفك استجابة JSON يعيّن مفاتيح السلك إلى الحقول المنطقية.

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

| الحد                                 | الحقل                     |
| ------------------------------------ | ------------------------- |
| `struct.parse(User, ...)` ومدخل الأمر | منطقي `displayName`       |
| كائن مُنوَّع يُسلَّم إلى الـ builder       | سلك `display_name`        |
| فك JSON / SSE / WebSocket            | سلك → منطقي `displayName` |
| كائن مجهول مكتوب في الـ builder      | المفتاح الذي كتبته        |

الأسماء المستعارة تعمل على الحقول المتداخلة والمصفوفات والكائنات والاتحادات والمميّزات. أبقِ الأسماء المنطقية في كود التطبيق؛ ضع الاسم الخارجي على الـ struct مرة واحدة. نشر كائن مُنوَّع يُبقي ذلك الترميز. تعيين الحقل المنطقي ومفتاح سلكه معًا في الكائن نفسه هو `REQ_BUILD_FAILED`. `JSON.stringify` لقيمة بنفسك يغادر هذا المسار: المُسلسِل يرى الأسماء المنطقية.

يُختار الدليل عند كل عقدة، لا عند الجذر فقط. الكائن الجديد تحت أب مجهول يُبقي المفاتيح التي كتبتها. الكائن نفسه تحت أب مُنوَّع يستخدم struct ذلك الحقل.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

عندما يطابق دليل الاتحاد أكثر من فرع، يُرمَّز كل فرع ثم تُقارَن النتائج. يُبقى الخرج السلكي المتطابق؛ والاختلاف هو `REQ_BUILD_FAILED`.

التقاطع المختلط الذي يتضمن جزءًا غير كائن يُوسَم عند التحليل باقتران وسوم الأجزاء المطابقة؛ وقيمة التقاطع المختلط المكتوبة من جديد دون تحليل تُعامَل ككائن مجهول.

## أعطال التحليل

`struct.parse(...)` يُرجع `[null, value]` أو `[StructError, undefined]`. `StructError` يمتد من `Error` ويعرض `issues`، مع `format()` و`flatten()` و`prettify()`.

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

`StructIssue` يملك `code` و`expected` و`message` و`path` و`received`. `code` هو `custom` أو `invalid_enum` أو `invalid_intersection` أو `invalid_literal` أو `invalid_type` أو `invalid_union` أو `missing_key`. المشاكل يمكن أن تحمل مدخلًا غير موثوق — احجب قبل التسجيل أو الإرجاع. `struct.parse(..., { errorMap })` يعيد كتابة رسائل المشاكل لذلك الاستدعاء فقط.

تحقق Struct بنيوي فقط. بلا قواعد عامة للنطاق أو التنسيق أو التحسين أو المصادقة أو انتقال الحالة. افعل تلك الفحوص قبل أن تبني أمرًا.

## المرجع

مُنشئات عامة على `@defjs/core` (الداخلية ليست واجهات الواجهة):

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

| المُنشئ                           | المدخل                                 | المخرج المستنتج                  |
| -------------------------------- | -------------------------------------- | -------------------------------- |
| `struct.number()`                | عدد غير `NaN`                          | `number`، بما في ذلك ±`Infinity` |
| `struct.date()`                  | `Date` أو عدد أو سلسلة تاريخ           | `Date` صالح                      |
| `struct.bigint()`                | `bigint` أو سلسلة يقبلها `BigInt(...)` | `bigint`                         |
| `struct.enum(...)`               | عضو سلسلة أو عدد معلَن                  | اتحاد ذلك الحرفي                 |
| `struct.discriminatedUnion(...)` | كائن بمميّز حرفي مطلوب                  | فرع الكائن المختار               |
| `struct.or(...)`                 | أول فرع مطابق؛ والترميز يفحص الغموض    | اتحاد مخرجات الفروع              |
| `struct.intersection(...)`       | قيم يقبلها كل عضو                      | تقاطع المخرجات                   |
| `struct.record(value)`           | كائن عادي تطابق قيمه `value`           | Record من القيم المحلَّلة          |
| `struct.tuple(items)`            | مصفوفة بالطول المعلَن بالضبط            | tuple بطول ثابت                  |

كل Struct يدعم `.alias(name)` و`.optional()` و`.null()` و`.nullish()`. `struct.discriminatedUnion` يحتاج خيارات كائن بمميّز حرفي مطلوب ويرفض التكرارات.

استورد `struct` و`Infer` و`Struct` و`StructError` والأنواع العامة ذات الصلة من `@defjs/core`. استخدم `struct.parse(...)` كالمحلّل. لا تستورد `createObjectStruct` أو رموز التعريف أو داخلية الترميز أو `packages/core/src`.

غير وعود الواجهة:

- مخرجات الكائن/السجل تستخدم نموذجًا أوليًا null — لا تفترض طرائق `Object.prototype`.
- مفاتيح الكائن المجهولة تُسقط.
- `struct.number()` يرفض `NaN`، ويقبل اللانهائيات.
- `struct.or(...)` يجرّب الفروع بالترتيب؛ ويرفض الترميزات الغامضة عندما تختلف الفروع.
- `struct.intersection(...)` يحلّل الأعضاء بترتيب الإعلان.
- intersection يدمج مخرجات الأعضاء بعمق (القيم المتساوية عبر `Object.is` والتواريخ ذات الوقت نفسه تبقى، والكائنات العادية والمصفوفات متساوية الطول تُدمج تكراريًا، وأي تعارض آخر هو `invalid_intersection` عند ذلك path)، و`unknown` / `any` لا يساهمان بشيء، ويمكن أن يقابل المفتاح المنطقي الواحد عدة مفاتيح wire؛ والتعارض يكون فقط عندما تُكتب قيم غير متساوية على مفتاح wire واحد.
- Struct يتحقق من حد؛ ولا يخزّن، ولا يفوّض، ولا يملك مورد نقل.

## وصفات ذات صلة

- [POST JSON](../recipes/post-json.md)
- [GET مع 404 معلَن](../recipes/get-declared-404.md)
