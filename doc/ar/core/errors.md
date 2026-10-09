---
title: Errors
description: تفرّع على مجموعة مغلقة من رموز الأخطاء لحالات 404 والمهل والأجسام غير المقروءة وفشل النقل.
---

# Errors

تعامَل مع 404 أو مهلة أو جسم غير مقروء بقراءة الـ tuple الذي يضع الخطأ أولًا، لا بالتقاط ما يُرمى. `Fault` هو `Error` أصلي (`instanceof Error` صحيح) ويُميَّز بحقل واحد: `code`.

لا يوجد `kind`. فصنف الفشل هو المقطع الذي يسبق أول `_` في رمزه، فـ `NET_TIMEOUT` فشلٌ من صنف `NET` و`RES_STRUCT_MISMATCH` فشلٌ من صنف `RES`. اقرأ البادئة للفرز التقريبي، والرمز كاملًا للحالة الدقيقة.

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

ولأن المجموعة مغلقة، فإن `switch` على `code` يستنفد كل الحالات:

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

## رموز مستقرة

| الصنف  | الرموز                                                                 | من الذي يجب أن يتغيّر                             |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------- |
| `HTTP` | `HTTP_STATUS`                                                          | الطرف المقابل أجاب بغير 2xx؛ تعامَل معه كمنطق عمل |
| `REQ`  | `REQ_INPUT_INVALID`، `REQ_OPTIONS_INVALID`، `REQ_BUILD_FAILED`         | الاستدعاء أو إعلان نقطة النهاية                   |
| `NET`  | `NET_ABORTED`، `NET_TIMEOUT`، `NET_UNREACHABLE`، `NET_BODY_INCOMPLETE` | لا أحد، أو إعادة المحاولة                         |
| `RES`  | `RES_MEDIA_TYPE_INVALID`، `RES_DECODE_FAILED`، `RES_STRUCT_MISMATCH`   | يجب التوفيق بين الإعلان والطرف المقابل            |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`، `EXT_HOOK_FAILED`، `EXT_OBSERVER_FAILED`     | الشيفرة التي وصلتها بخط المعالجة                  |
| `CAP`  | `CAP_BUFFER_EXCEEDED`، `CAP_QUEUE_OVERFLOW`                            | حدٌّ معلَن، أو وتيرة المستهلك                     |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | بيئة التشغيل المضيفة                              |

المجموعة مغلقة عن قصد: وهذا بالضبط ما يُبقي `switch` مستنفدًا. والإضافات تُبلِّغ عن تفصيلها الخاص عبر `cause`، لا عبر رمز جديد.

### الحقول بحسب الشكل

| الرمز         | `status` | `response`                                                | `data`                              |
| ------------- | -------- | --------------------------------------------------------- | ----------------------------------- |
| `HTTP_STATUS` | دائمًا   | دائمًا؛ ولا يحمل `body` إلا إذا أُعلن `error` وفُكّ بنجاح | جسم `error` المفكوك، أو `undefined` |
| `RES_*`       | دائمًا   | دائمًا، بيانات وصفية فقط — **بلا `body`**                 | غائب                                |
| كل ما عدا ذلك | غائب     | فقط حيث كانت لدى طبقة النقل بيانات وصفية بالفعل           | غائب                                |

`cause` يحمل القيمة الأساسية: `StructError` عند عدم مطابقة struct، وفشل المحلِّل عند تمثيل غير مقروء، وأيّ شيء رمته إضافة.

## أشكال الـ tuple بحسب النقل

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

عند فشل HTTP يكون العنصر الثالث `undefined`: فالخطأ يحمل أصلًا ما وُجد من بيانات الاستجابة الوصفية. وهذا مهم لأن الخطأ هو ما تمرّره إلى معالِج، أو تسجّله، أو ترميه من جديد، فوجب أن تسافر البيانات الوصفية _معه_ لا بجانبه.

في SSE و WebSocket يكون العنصر الثالث لقطةَ بدءٍ قد تكون موجودة حتى عند فشل البدء. وبعد أن يعود المِقبض أو الجلسة، تعيش حالات الفشل اللاحقة على دورة حياته — ولا تُعيد كتابة tuple البدء الذي استقر.

## كيف يُقرأ الجسم

`ok` هو نقطة التفرّع الوحيدة، ولا يُفكّ إلا طرف واحد. `output` يقرأ جسم 2xx؛ و`error` يقرأ كل ما عداه. وحذف أحدهما يعني أن ذلك الجسم لا يُقرأ أبدًا.

| الحالة                                    | النتيجة                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| 2xx، و`output` معلَن، والجسم يُفكّ        | نجاح؛ `data` و`response.body` مُنوَّعان                |
| 2xx، و`output` محذوف                      | نجاح؛ `data` هو `undefined`، والاستجابة بلا `body`     |
| غير-2xx، و`error` معلَن، والجسم يُفكّ     | `HTTP_STATUS` مع `data` مُنوَّع                        |
| غير-2xx، و`error` محذوف                   | `HTTP_STATUS` مع `data: undefined`                     |
| نوع الوسائط ليس ما يحتاجه التمثيل         | `RES_MEDIA_TYPE_INVALID`، ويُبلَّغ **قبل** قراءة الجسم |
| البايتات ليست ذلك التمثيل                 | `RES_DECODE_FAILED`                                    |
| القيمة ليست ذلك الـ struct                | `RES_STRUCT_MISMATCH`                                  |
| جسم غير مقروء في الطرف الذي **لم** تُعلنه | يُهمَل كليًّا — انظر أدناه                             |

السطر الأخير هو ما يستحق التذكّر. فإن أعلنت `output` ولم تُعلن `error`، فإن استجابة 500 بجسم JSON تالف تُبلَّغ كـ `HTTP_STATUS` مع `status: 500`. لقد قلت إن أجسام الأخطاء لا تهمّك، وهذا يشمل ألّا يهمّك أن أحدها لم يكن قابلًا للقراءة.

الفكّ يحدث مرة واحدة، بعد سلسلة المعترضات. والاستجابة التي بناها معترض بـ `makeResponse(...)` تمرّ بنفس فحص نوع الوسائط ونفس الـ struct كأي استجابة من الشبكة.

`HttpResponse.ok` يعني فقط `200 <= status < 300`. وفشل النقل خطأ لا استجابة أبدًا — فلا توجد استجابة بحالة صفر تنوب عنه.

## تضييق اتحاد أجسام الأخطاء

`error` واحد يغطي كل الحالات غير-2xx، فعندما تختلف الأشكال تُعلن اتحادًا. وما تستطيع فعله بـ `fault.data` بعد ذلك يتوقف كليًّا على كيفية إعلانك لذلك الاتحاد — فالمكتبة تُعيد لك بالضبط النوع الذي طلبته.

`struct.or(...)` ينتج اتحادًا عاديًا لا يستطيع TypeScript تضييقه وحده. فاختبر الحقل الذي تحتاجه:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` يُضيّق عبر حقل يحمله الجسم فعلًا، وهي الصورة المريحة حين تكون الـ API قد وسمت أخطاءها أصلًا:

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

وحين تضع الـ API الحالة **داخل** الجسم، مَيِّز عبرها بدل `fault.status`:

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

تستحق هذه الصورة الأخيرة التفضيل حيث تدعمها الـ API. فـ `fault.status` رقمٌ في طبقة HTTP يستطيع وكيل أو بوابة أو CDN إعادة كتابته؛ أما `data.status` فقد فُكّ من الجسم الذي أكّده `error` الخاص بك، فالوصول إليه دليلٌ على أن الخادم هو من أنتجه.

والاتحاد غير المُميَّز الذي لا يمكن تضييقه صفةٌ في الإعلان لا في المكتبة — فهي تعطيك النوع الذي أعلنته. أضِف حقلًا مميِّزًا إلى الـ struct إن أردت تضييقًا.

## البدء مقابل ما بعد الفتح

يتحقّق SSE من الحالة ومن `text/event-stream` ومن وجود جسم قبل أن يستقرّ المِقبض. غير-2xx → `HTTP_STATUS`. نوع وسائط خاطئ → `RES_MEDIA_TYPE_INVALID`. جسم مفقود → `RES_DECODE_FAILED`. ومع ذلك قد تحلّ لقطة الفتح في العنصر الثالث من الصفيف.

بدء WebSocket يغطي المصافحة مع أول فتح فيزيائي. وفشل الباني، أو الإغلاق قبل الفتح، أو المهلة، أو الإلغاء، تنتج كلها صفيف بدء. وقد توجد لقطة اتصال حتى لو لم يصل المقبس إلى `open` أبدًا.

| النقل     | بعد البدء                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| SSE       | يرفض المُكرِّر عند خطأ قاتل؛ ويستقرّ `stream.closed` بـ `kind: 'error'` ورمز الخطأ                                                              |
| WebSocket | `onRuntimeError` لفشل الرسائل/الطابور/النبض؛ ويفشل `receive` عند الأخطاء النهائية؛ و`session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP      | وعد execute يستقرّ مرة واحدة. وشيفرة المعترضات وردود النداء قد ترمي مع ذلك خارج تطبيع الصفيف                                                    |

`NET_ABORTED` / `NET_TIMEOUT` تصف ما رآه المستدعي عند البدء. ومع ذلك تُغلق أي مجرى أو جلسة عادت إليك وتنتظر وعدها النهائي.

## تسجيل Error الأصلي و cause

الأخطاء هنا نسخ من `Error` الأصلي، فلا حاجة إلى مُهايئ تشخيص. و`String(fault)` يعطي الصورة الأصلية المستقرّة `DefjsFault: <message>`. و`code` وحقول كل صيغة — `status` و`response` و`data` — تبقى قابلة للتعداد من أجل التسجيل المهيكل؛ أما `name` وسلسلة `cause` الأصلية فغير قابلة للتعداد.

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

ضيِّق `fault.cause instanceof StructError` قبل استدعاء `format()` أو `flatten()` أو `prettify()`. فهذه الدوال تعيش على cause الخاص بـ Struct ولا تُنسخ إلى الخطأ. ولا تجعل مسار التحكم يحلّل `message` أو `String(fault)` — فالعقد هو `code` و`status` مُراجَع.

## مرجع

| الفرع                   | فحص مسار التحكم                    | حقول مستقرّة مفيدة                         | غالبًا غائب / حسّاس                |
| ----------------------- | ---------------------------------- | ------------------------------------------ | ---------------------------------- |
| سياسة حالة HTTP         | `fault.code === 'HTTP_STATUS'`     | `fault.status`، و`fault.data` مُراجَعًا    | الجسم، الترويسات، الـ URL، `cause` |
| إلغاء من المستدعي       | `fault.code === 'NET_ABORTED'`     | `code`                                     | سبب الإلغاء والمكدّس               |
| مهلة                    | `fault.code === 'NET_TIMEOUT'`     | `code`                                     | عنوان الطلب والسبب الأساسي         |
| انكسر العقد             | `fault.code.startsWith('RES_')`    | `code`، و`fault.response.status` مُراجَعًا | مشكلات Struct، الجسم، قيم الدخل    |
| شيفرتك أنت رمت          | `fault.code.startsWith('EXT_')`    | `code`، `cause`                            | أيّ شيء أرفقته الإضافة             |
| زمن تشغيل المجرى/الجلسة | `stream.closed` / `session.closed` | `kind` و`code` النهائيان                   | حمولات الأحداث، الأُطُر، الأسباب   |

اعتبر `cause` و`data` وترويسات الاستجابة وأجسامها وعناوين URL ومشكلات Struct وقيم الدخل والمكادس معلوماتٍ حسّاسة. وهذا ملخّص محافظ:

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault` و`createPreflightFault` و`createDecodeFault` و`createHttpStatusFault` و`createUndecodedHttpStatusFault` تبني قيم Error الأصلية هذه. وحالات فشل الطلب العادية تُعاد كما هي في الصفيف؛ ولا تُرمى لمجرد أنها ترث سلوك Error الأصلي. و`ERR_ABORTED` و`ERR_TIMEOUT` هما السببان المشتركان الذي يتعرّف عليهما مُطبِّع النقل.

## وصفات ذات صلة

- [GET مع 404 معلَن](../recipes/get-declared-404.md)
- [إلغاء نداء HTTP](../recipes/cancel-http.md)
