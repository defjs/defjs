---
title: HTTP
description: عرّف طلبًا، نفّذه، فرّع على الحالة، وألغِ بـ signal أو timeout.
---

# HTTP

عرّف → نفّذ → فرّع على الـ tuple → ألغِ عندما تختفي الشاشة. هذه حلقة HTTP كاملة.

## الإعداد الأساسي

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

## حلّ عنوان URL

`withEndpoint(...)` يحتاج عنوان URL مطلقًا صالحًا. مسار نقطة النهاية يبقى دليلًا؛ يُهمل الاستعلام والـ hash قبل حل الأمر.

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

عناصر المسار النائبة قيم قياسية خام، تُرمَّز مرة واحدة بالضبط. تُرفض القيم الفارغة و`.` / `..`. الشرطة المائلة و`?` و`#` و`%` والمسافات وUnicode داخل عنصر نائب واحد تبقى مقطعًا مرمَّزًا واحدًا — لا ترمّز مسبقًا.

مسار التعريف لا يمكن أن يحتوي `?` أو `#`، ولا أن يكون مطلقًا أو نسبيًا للبروتوكول. مرمّز الاستعلام الافتراضي يقبل القيم القياسية ومصفوفات القيم القياسية (المصفوفات تكرر المفتاح). كائن متداخل يفشل بـ `REQ_BUILD_FAILED` ما لم يملك العميل `withQuerySerializer(...)`. `null` في `path` أو `query` أو `headers` يفشل بالطريقة نفسها. `undefined` يُحذف.

## ضع المدخل

الـ struct يرمّز القيمة. والـ builder يضعها. احذف `builder` عندما يكون `input` أصلًا `{ path?, query?, headers?, body? }`.

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

ذلك الجسم هو `{"display_name":"Ada"}` مع `application/json`. اسم الرأس على السلك هو `x-request-id`. المستدعون والنتائج المحلَّلة يبقون `displayName`.

فضّل تسليم القيمة المُنوَّعة على تهجئة مفاتيح السلك. يُعلَن alias مرة واحدة على الحقل وينطبق في الاتجاهين: `output` / `error` / الأحداث / الإطارات الواردة تفك `display_name` إلى `displayName`، و`body: input.order` يعيد كتابة الشجرة كلها. يمكن لـ struct `User` نفسه أن يكون جسم إنشاء ومخرج جلب. المفتاح الذي تكتبه بنفسك هو الاستثناء: الكائن الأب مجهول، فلا يعمل الـ alias.

| تعبير الـ builder                               | على السلك                                             |
| ----------------------------------------------- | ----------------------------------------------------- |
| `body: input.profile`                           | كائن مُنوَّع: ترميز alias و`Date` / `bigint`             |
| `body: { profile: input.profile }`              | المفاتيح الخارجية حرفية، والكائن الداخلي ما زال مُنوَّعًا |
| `body: { ...input.profile, role: 'admin' }`     | النشر يُبقي الـ struct؛ والمفتاح الإضافي حرفي           |
| `body: { name: input.profile.displayName }`     | أب مجهول: لا ينطبق الـ alias                           |
| `query: input.query` / `headers: input.headers` | كائنات مسطّحة مُنوَّعة: يصبح alias مفتاح السلك            |

نشر كائن مُنوَّع مع تعيين مفتاح سلكه أيضًا (`display_name` بجانب `displayName`) هو `REQ_BUILD_FAILED`. كائن متداخل في `path` أو `headers` يفشل بالطريقة نفسها.

يُختار الدليل عند كل عقدة، لا عند الجذر فقط. الكائن الجديد تحت أب مجهول يُبقي المفاتيح التي كتبتها. الكائن نفسه تحت أب مُنوَّع يستخدم struct ذلك الحقل.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

عندما يطابق دليل الاتحاد أكثر من فرع، يُرمَّز كل فرع ثم تُقارَن النتائج. يُبقى الخرج السلكي المتطابق؛ والاختلاف هو `REQ_BUILD_FAILED`.

التقاطع المختلط الذي يتضمن جزءًا غير كائن يُوسَم عند التحليل باقتران وسوم الأجزاء المطابقة؛ وقيمة التقاطع المختلط المكتوبة من جديد دون تحليل تُعامَل ككائن مجهول.

### الاستعلام

شكل الاستعلام المتداخل (`a[b]` و`a.b` والقوائم المفصولة بفواصل) اصطلاح للخلفية، لذا الخطاف على العميل:

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

`query` هنا هو كائن السلك المرمَّز. الأسماء المستعارة مُطبَّقة أصلًا، لذا مُسلسِل مثل `qs` لا يسقطها. السلسلة المُعادة هي سلسلة الاستعلام. Defjs لا تعتمد على `qs`.

بلا مُسلسِل، المصفوفات تكرر المفاتيح والكائن المتداخل هو `REQ_BUILD_FAILED`. إرجاع `URLSearchParams` من الـ builder يستخدم تلك القيمة كما هي ويتخطى المُسلسِل. لا يُستدعى المُسلسِل عندما لا يوجد استعلام. يرى المعترضون بعد ذلك `queryParams` كـ `new URLSearchParams(queryString)`.

### الجسم

أول تطابق يفوز:

| قيمة `body`                                        | تُرسَل كـ                                                                     | نوع المحتوى الافتراضي                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| محذوف / `undefined`                                | بلا جسم                                                                      | —                                                     |
| كائن مُنوَّع جذره يحمل وسم `urlencoded` أو `formData` | `URLSearchParams` / `FormData`؛ المفاتيح أسماء سلك؛ المصفوفات تكرر المفاتيح | نوع النموذج / حد المنصة                               |
| `FormData`، `URLSearchParams`                      | كما هي                                                                      | نفسه؛ Defjs تمسح `Content-Type` القديم على `FormData` |
| `Blob` / `File`                                    | كما هي                                                                      | `blob.type`، أو `application/octet-stream`            |
| `ArrayBuffer`، `TypedArray`، `DataView`            | كما هي                                                                      | `application/octet-stream`                            |
| `ReadableStream`                                   | متدفّق (`duplex: 'half'` عندما يسمح وقت التشغيل)                             | `application/octet-stream`                            |
| `string`                                           | كما هي                                                                      | `text/plain;charset=UTF-8`                            |
| كائن، مصفوفة، عدد، قيمة منطقية، `null`             | مرمَّز، ثم `JSON.stringify`                                                   | `application/json`                                    |

اضبط `content-type` على `headers` لتجاوز الافتراضي. وسم الترميز ينطبق فقط عند جذر الجسم: `body: { meta: input.form }` هو JSON، وحقول النموذج حقول JSON عادية. السلسلة نص خام؛ وسلسلة JSON مثل `"abc"` تحتاج `JSON.stringify` مع `application/json`. حقول `undefined` تُحذف؛ وحقل `nullable` مُرسَل كـ `null` هو JSON `null`.

`GET` و`HEAD` لا يمكنهما إرجاع جسم — ذلك خطأ نوع. بنّاؤو WebSocket لا يمكنهم إرجاع `headers` أو `body`.

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

`JSON.stringify` أو `qs` أو protobuf الذي تشغّله بنفسك يرى الأسماء المنطقية. لا ينطبق alias على ذلك المسار. لا يوجد `struct.encode` عام.

يجوز للـ builder أن يتفرّع على المدخل الحقيقي ويُرجع جسمًا مختلفًا لكل حالة (سجلات JSON أو `File` أو `URLSearchParams`). `Headers` الأصلية تُمرَّر أيضًا ولا تُعاد ترميزها.

## كيف يُقرأ الجسم

`output` هو Struct واحد لجسم 2xx؛ و`error` هو Struct واحد لكل ما عداه. نوع الـ struct
يختار التمثيل: `string` نص خام، و`blob` / `file` blobs، و`arrayBuffer` بايتات،
وكل نوع آخر JSON. وإن لم يُعلَن أي طرف، فالجسم لا يُقرأ أبدًا.

ترتيب العمليات:

1. `ok` يختار الطرف: `output` لـ 2xx، و`error` لكل ما عداه. لا الاثنان معًا أبدًا.
2. لا شيء معلَن لذلك الطرف → الجسم لا يُقرأ أبدًا. 2xx ينجح مع `data === undefined`؛
   وغير-2xx هو `HTTP_STATUS` مع `data === undefined`. جسم غير مقروء في طرف لم
   تُعلنه يُتجاهل، بما في ذلك حقيقة أنه لم يكن قابلًا للقراءة.
3. يُفحص نوع الوسائط **قبل** قراءة الجسم. عدم التطابق هو `RES_MEDIA_TYPE_INVALID` ولا
   يُحلَّل شيء ولا يُفك.
4. يُقرأ التمثيل. الفشل هو `RES_DECODE_FAILED`. يُحلَّل JSON القادم من النقل مرة واحدة: السلسلة النصية في
   هذه القيمة جذر نصي JSON ولا تُحلَّل مرة أخرى؛ البايتات والـ blobs خامّة وتُحلَّل مرة واحدة.
5. يحلّل الـ Struct القيمة. الفشل هو `RES_STRUCT_MISMATCH`.
6. 2xx → النتيجة و`response.body` مُنوَّع؛ وغير-2xx → `data` مُنوَّع على `HTTP_STATUS`.

الفك يحدث مرة واحدة، بعد سلسلة المعترضات، فالاستجابة التي بناها معترض بـ
`makeResponse(...)` تُقرأ تمامًا كتلك القادمة من الشبكة. في تمثيل JSON، جسم السلسلة النصية هو جذر نصي JSON.

الاستجابة الناجحة هي `DecodedResponse<T>`: `url` و`status` و`statusText` و`headers` و`ok` و
`body` مُنوَّع. وحيث لم يُفك شيء تحصل على `HttpMeta` — الحقول نفسها بلا `body`. `ok`
يعني فقط `200 <= status < 300`. وليس أي منهما `Response` أصليًا. فشل النقل خطأ، فلا
توجد استجابة بحالة 0 تنوب عنه.

## ألغِ العمل {#cancel-the-work}

خيارات التنفيذ تأخذ `signal` مع إما `abort` أو `timeout`. **`abort` و`timeout` متنافيان.** يمكن لـ `signal` أن يجتمع مع أي منهما.

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

يجب أن يكون `timeout` عددًا صحيحًا آمنًا موجبًا في `1..2_147_483_647`. الإلغاء المتعرَّف عليه → `NET_ABORTED`؛ ومهلة التنفيذ → `NET_TIMEOUT`؛ ورمي المعترض → `EXT_INTERCEPTOR_FAILED`؛ وفشل Fetch الآخر → `NET_UNREACHABLE`. الإلغاء بعد أن قبل الخادم كتابة **لا** يثبت أن الكتابة تراجعت.

## بيانات الاعتماد وXSRF

`withCredentials(true)` يضبط Fetch `credentials: 'include'` لـ HTTP وSSE. لا ينشئ `Authorization` ولا يضبط مصادقة WebSocket. `false` يترك بيانات الاعتماد غير محددة.

`withXSRF(...)` لـ HTTP فقط. الافتراضي: `cookieName: 'XSRF-TOKEN'`، `headerName: 'X-XSRF-TOKEN'`. يُحقن الرأس فقط للطرائق غير الآمنة، وفقط عندما لم يضبطه المستدعي أصلًا، وفقط لطلبات المتصفح من الأصل نفسه. يتخطى `GET` و`HEAD` و`OPTIONS` و`TRACE`. خارج المتصفح، مرّر `tokenProvider` متزامنًا محدودًا بالطلب إن احتجت الحقن.

أبقِ بيانات الاعتماد ورموز XSRF وسلاسل الاستعلام خارج السجلات الروتينية. لا تستخدم معاملات الاستعلام قناة بيانات اعتماد عامة.

## التقدّم وحد Fetch

`onDownloadProgress` يعمل أثناء قراءة جسم استجابة معلَن. `lengthComputable` صحيح فقط مع `Content-Length` موجب. بلا struct لذلك الطرف → الجسم لا يُقرأ → لا تقدّم لقراءة الجسم.

`onUploadProgress` يراقب جسم طلب `ReadableStream<Uint8Array>` بينما يقرأه Fetch. جسم JSON أو النص ليس ذلك التدفق — أرجِع `file.stream()` (أو `ReadableStream` آخر) من الـ builder عندما تحتاج تقدّم الرفع. يبلّغ النقل عن خطأ قدرة عندما لا يستطيع وقت التشغيل إرسال جسم متدفّق.

`fetchHandler(httpRequest, fetchImpl?)` هو حد Fetch الأدنى: يبني `Request` أصليًا، ويستدعي Fetch، ويقرأ التمثيل، ويُرجع `HttpResponse`. وهو **لا** يتحقق من مدخل الأمر، ولا يوزّع `output`، ولا يشغّل المعترضات. مفيد لاختبارات النقل المحقون — وليس بديلًا عن `client.execute`.

## حدود إعادة التشغيل

Defjs **لا** تعيد محاولة HTTP تلقائيًا. إعادة محاولة قراءة ما زالت تحتاج سياسة مهلة/شبكة/تكرار مراجعة. إعادة محاولة طفرة تحتاج بايتات قابلة لإعادة التشغيل، ودعم الخادم، ومفتاح تكرار آمن مربوط بنطاق المصادقة + بايتات الطلب، وسياسة تكرار لدى المستقبِل.

حد العميل/الأمر/Fetch لا يستطيع أن يعرف إن كانت الكتابة الفاشلة قد اكتملت. أبقِ قرارات إعادة التشغيل في التطبيق أو في معترض مراجع. يمكن للمعترضات أن تختصر المسار أو تستبدل الطلب منخفض المستوى؛ ويجب أن تظل الحالة النهائية والجسم مستوفيين لعقد الأمر.

## وصفات ذات صلة

- [GET مع 404 معلَن](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [إلغاء استدعاء HTTP](../recipes/cancel-http.md)
- [الاختبار بـ Fetch محلي](../recipes/test-with-handle.md)
