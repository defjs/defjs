---
title: Server-Sent Events
description: استهلك تدفق SSE مُنوَّعًا، أغلقه، وانتظر وعد closed النهائي.
---

# Server-Sent Events

افتح تدفقًا، وكرّره، ثم أطلق المقبض المملوك بـ `await using`. يبقى `close()` و`closed` اليدويان متاحين؛ والعملاء والإضافات لا يتخلّصون من تدفق مُرجَع نيابةً عنك.

## الإعداد الأساسي

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: {
    message: struct.object({ text: struct.string() }),
  },
})

const [error, stream] = await client.execute(notifications())
if (error) {
  console.error(error.code)
} else {
  await using ownedStream = stream
  for await (const event of ownedStream) {
    if (event.event === 'message') console.log(event.data.text)
  }
}
```

## عرّف التدفق

`defineEventStream(...)` يحتاج `events`، و`maxBufferSize` عددًا صحيحًا آمنًا موجبًا، و`maxQueueSize` عددًا صحيحًا آمنًا موجبًا، و`path` نسبيًا. الطريقة الافتراضية `GET`.

شكل الطلب يطابق HTTP: `builder` اختياري يُرجع `path` و`query` و`headers` و`body`. `GET` / `HEAD` لا يمكنهما إرجاع جسم. struct `error` معلَن يُنوّع خطأ البدء ويفك جسم مصافحة غير-2xx حسب نوع الـ struct (نص `string`، وblob لـ `blob` / `file`، وبايتات لـ `arrayBuffer`، وإلا JSON). Defjs ترسل `Accept: text/event-stream` عندما لم تضبط `Accept` أصلًا.

تدفق منطقي واحد يمكن أن يمتد على عدة محاولات Fetch مادية **عندما** تختار إعادة الاتصال. بلا `withSSEReconnect`، فشل الشبكة العابر وفشل قراءة التدفق ينهيان التدفق المنطقي. ما زلت تحصل على مقبض واحد ومكرّر غير متزامن واحد عندما ينجح الفتح.

## افتح وافحص

`client.execute(...)` يُحل فقط بعد نجاح فحوص الحالة ونوع المحتوى والجسم:

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: { message: struct.string() },
})

const [error, stream, startupOpen] = await client.execute(notifications())
if (error) {
  console.error(error.code, startupOpen?.response.status)
} else {
  console.log(stream.open.response.status, startupOpen.response.status, stream.open.url)
  stream.close('example-finished')
  await stream.closed
}
```

يجب أن تكون الاستجابة ناجحة، وجوهر نوع الوسائط `text/event-stream`، ولها جسم. بدء غير-2xx → `HTTP_STATUS`. عند إعلان `error` يحمل ذلك الخطأ جسم المصافحة المفكوك؛ ونوع وسائط سيئ هو `RES_MEDIA_TYPE_INVALID`، وجسم لا يمكن قراءته كالنوع المعلَن هو `RES_DECODE_FAILED`. لقطة استجابة يمكن أن تبقى في الخانة الثالثة من الـ tuple عندما يفشل التحقق بعد وصول الاستجابة.

`startupOpen` هي اللقطة الأولية. `stream.open` حي ويتغيّر عند الفتحات المادية اللاحقة. احتفظ بقيمة الـ tuple عندما تهم الاستجابة الأولى.

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## فكّ الأحداث

اسم الحدث على السلك → `events[eventName]`؛ وإلا `events.default`. بلا Struct مطابق → الحدث لا يُسلَّم. حقل SSE `event` المفقود → الاسم المنطقي `message`.

`data` في SSE يبدأ كنص. struct من نوع `string` يُبقي ذلك النص. كل نوع آخر هو JSON: حلّل النص، ثم فكّه بالـ struct. `struct.object` و`struct.number` و`struct.boolean` و`struct.any` و`struct.unknown` هي JSON، وليست نصًا مقصوصًا. رمز عارٍ مثل `ping` لا يُرضي `struct.literal('ping')`؛ يجب أن تكون البيانات JSON. خادم يرسل سلسلة JSON `"abc"` يُرضي `struct.string()` مع ذلك: القيمة المُسلَّمة هي ذلك النص الخام بما فيه علامات الاقتباس، ولا تُفك عبر JSON إلى `abc`.

القيمة المُصدَرة: `event`، و`data` مفكوك، و`id` اختياري غير فارغ. مع `default`، أسماء الأحداث المجهولة هي `string` في الاتحاد المستنتج.

## راقب الأحداث غير الصالحة

الأحداث غير الصالحة/غير المعلَنة تُسقط، لا تُصفّ. `withSSEOnInvalidEvent(...)` يمكن أن يراقب المعرّف الخام والاسم وبيانات النص، مع `missing-struct` أو `validation-failed` وسبب اختياري.

```ts
import { createClient, withEndpoint, withSSEOnInvalidEvent } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEOnInvalidEvent(({ reason, message, cause, signal }) => {
    if (signal.aborted) return
    console.info('Dropped SSE event', {
      reason,
      event: message.event,
      hasCause: cause !== undefined,
    })
  }),
)
```

المراقب يعمل عند حد التحويل. فشله معزول ما لم تُجهَض إشارة المحاولة النشطة. أبقِه قصيرًا؛ لا تعامل بيانات الحدث الخام كموثوقة.

## أعد الاتصال

**تغيّر في السلوك:** إعادة اتصال SSE اختيارية. بلا `withSSEReconnect(...)`، فشل الشبكة وقراءة التدفق **لا** يُعاد (كما في `attempts: 0`). مرّر `withSSEReconnect({ attempts: 3 })` (أو ميزانية مراجعة أخرى) لإعادة محاولة تلك الأعطال. EOF العادي لا يُعاد. تحقق الحالة/نوع المحتوى، وحدود المحلّل، وأعطال تحويل الرسالة، وفيضان الطابور، وEOF العادي تبقى نهائية للتدفق المنطقي.

```ts
import { createClient, withEndpoint, withSSEReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEReconnect({
    attempts: 3,
    delayMs: 1_000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.5,
    shouldReconnect({ attempt, open }) {
      return attempt <= 3 && (open?.response.status ?? 0) !== 401
    },
  }),
)
```

`attempts` يعدّ إعادات المحاولة بعد المحاولة الأولية؛ والافتراضي `3` عند ضبط كائن إعادة اتصال. `attempts: 0` يعطّل إعادة المحاولة. حذف `withSSEReconnect` يعطّل إعادة المحاولة أيضًا. `delayMs` هو الفاصل الأولي؛ و`factor` يكبره؛ و`maxDelayMs` يحد الأساس. `jitter` في SSE **عامل ضربي بين 0 و1**، مثل WebSocket. حقل تدفق `retry:` يحدّث الفاصل الحالي. ردّ callback السياسة بـ false / رمي / رفض ينهي التدفق المنطقي.

أحدث معرّف حدث محلَّل يصبح `Last-Event-ID` في محاولة لاحقة. المحاولة اللاحقة تعيد إرسال طلب Fetch نفسه، بما في ذلك الطريقة والجسم. اعرف دلالات إعادة التشغيل على الخادم قبل إعادة الاتصال.

## حدود المخزن والطابور

كلاهما يجب أن يكونا أعدادًا صحيحة آمنة موجبة. الفيضان قاتل — بلا إسقاط صامت لأحداث أقدم.

| الحد            | يحمي                                        | الرمز النهائي         |
| --------------- | ------------------------------------------- | --------------------- |
| `maxBufferSize` | سطر/حدث SSE غير مكتمل أو مفرط أثناء التحليل | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | أحداث تُنتج أسرع مما يقرأ المستهلك الواحد   | `CAP_QUEUE_OVERFLOW`  |

التدفق القاتل أيضًا يمسح الأحداث المخزّنة، ويلغي الجسم النشط، ويرفض المكرّر، ويحل `stream.closed` بـ `kind: 'error'`.

## أغلق وتخلّص

`EventStreamHandle`: لقطة فتح حية واحدة، ووعد نهائي واحد، و`close` واحد، ومكرّر غير متزامن واحد، ومتخلّص غير متزامن قياسي واحد.

```typescript twoslash
import type { EventStreamCloseInfo, EventStreamHandle, EventStreamOpenInfo } from '@defjs/core'

interface StreamApi<T> extends AsyncIterable<T>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}

const handle = null as unknown as EventStreamHandle<string>
const api: StreamApi<string> = handle
void api
```

الرموز النهائية: `eof` أو `aborted` أو `error`. نتيجة `error` تحمل أيضًا `EventStreamFaultCode`: `CAP_BUFFER_EXCEEDED` أو `CAP_QUEUE_OVERFLOW` أو `EXT_HOOK_FAILED` أو `EXT_OBSERVER_FAILED` أو `NET_TIMEOUT` أو `NET_UNREACHABLE` أو `RES_DECODE_FAILED` أو `RES_MEDIA_TYPE_INVALID`.

`close(reason)` يجهض المحاولة النشطة، ويغلق الطابور، ويستقر كـ `aborted`. `break` / `return` / الرمي في الحلقة يستدعي إرجاع المكرّر ويغلق بـ `iterator-return`. الكود الذي ينفّذ الأمر يملك الإغلاق.

`await using` يستدعي مسار الإغلاق المملوك نفسه وينتظر حتى تتوقف قراءة Defjs وعمل إعادة الاتصال ويُحرَّر قفل القارئ النشط. وهو محدود عمدًا حول وعد `ReadableStream.cancel()` يتحكم به المزوّد ولا يستقر أبدًا، فلا يضمن اكتمال وعد مزوّد كهذا. يبقى `stream.close(reason)` الصريح مع `await stream.closed` صالحًا عندما تحتاج سببًا أو النتيجة النهائية.

تطبيقات `EventStreamHandle` الهيكلية المخصصة يجب أن توفّر الآن `[Symbol.asyncDispose](): PromiseLike<void>` وتربطه بدورة الحياة نفسها. ذلك تغيير كاسر وقت الترجمة للمنفّذين؛ والمستهلكون الذين يستقبلون فقط مقبض Defjs لا يحتاجون استدعاء أي شيء جديد وقت التشغيل.

العقد الأدنى للمكتبة، المدعوم والمتحقق منه في المستودع، هو `ES2022` و`ESNext.Disposable` و`DOM` و`DOM.Iterable`، والمستودع مثبّت على TypeScript 7. هذه البنود الأربعة تُتحقق معًا كخط أساس واحد؛ وهذا لا يدّعي أن كل إعلان يفرض كل بند مستقلًا، ولا يُوعَد بمترجمات أقدم غير مختبرة. عميل HTTP العادي ليس `AsyncDisposable`؛ أدر كل طلب بمهلته أو `AbortSignal`.

أبقِ بيانات الاعتماد وبيانات الأحداث ومعرّفات الأحداث والأسباب وعناوين URL للتدفق خارج السجلات الروتينية. `withCredentials(true)` يؤثر على ملفات تعريف ارتباط Fetch لـ SSE؛ ولا يضبط مصادقة WebSocket.

## وصفات ذات صلة

- [استهلاك تدفق SSE](../recipes/consume-sse.md)
- [إلغاء استدعاء HTTP](../recipes/cancel-http.md)
