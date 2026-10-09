---
title: WebSocket
description: ابدأ جلسة JSON مُنوَّعة، استقبل وأرسل أغلفة، ثم أغلق وانتظر closed.
---

# WebSocket

ابدأ → استقبل → أرسل → أطلق بـ `await using`. أنت تملك إلغاء الاشتراك والتخلّص. يبقى `close()` / `closed` اليدوي متاحًا؛ والعملاء والمزوّدون والمعترضات لا تغلق الجلسات تلقائيًا.

## الإعداد الأساسي

```typescript twoslash
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
  outgoing: struct.object({ type: struct.literal('send'), text: struct.string() }),
})

const [error, session, startupConnection] = await client.execute(room())
if (error) {
  console.error(error.code, startupConnection?.generation)
} else {
  await using ownedSession = session
  const unsubscribe = ownedSession.onRuntimeError((cause) => console.error('runtime', cause))
  try {
    ownedSession.send({ type: 'send', text: 'Hello' })
    // wire: {"type":"send","text":"Hello"}
    for await (const message of ownedSession.receive) {
      console.log(message.type, message.text)
      break
    }
  } finally {
    unsubscribe()
  }
}
```

## struct واحد لكل اتجاه

`incoming` هو struct واحد لكل إطار نص. `outgoing` هو struct واحد لـ `session.send(...)`. نمذج عدة أنواع بـ `struct.discriminatedUnion`. الـ alias على تلك الحقول هو اسم السلك في الاتجاهين. لا يوجد غلاف نوع منفصل ولا مُطبّع.

```json
{ "type": "message", "text": "Hello" }
```

إطارات النص الواردة و`ArrayBuffer` والمصفوفة المُنوَّعة و`Blob` تُقرأ كـ UTF-8، ثم تُحلَّل JSON، ثم تُفحص مقابل `incoming`. JSON التالف وأعطال الـ struct تذهب إلى `session.onRuntimeError` ولا تُصفّ. الجلسة تبقى قائمة. الإطارات التي ليست نصًا أو بايتات أو `Blob` تُتجاهل. لا يوجد `withWebSocketOnInvalidEvent`.

`session.send(...)` يتحقق ويُسلسل بشكل متزامن: ترميز الـ struct، ثم `JSON.stringify`. يرسل فورًا عندما يكون مفتوحًا، ويصف أثناء `reconnecting` عندما يُفعَّل طابور صادر، ويرمي `InvalidStateError` عندما لا يكون قابلاً للكتابة. يرمي أيضًا عندما لا يوجد struct صادر، أو تفشل الحمولة في الـ struct، أو يكون الطابور الصادر معطّلًا أو ممتلئًا، أو يفشل الإرسال الأصلي. قائمة `protocols` الثابتة على التعريف هي عقد نقطة النهاية (مثل `graphql-transport-ws`). خيارات التنفيذ و`withWebSocketProtocols` ما زالا يستطيعان تجاوزها؛ والرمز داخل بروتوكول فرعي ينتمي إلى `beforeConnect` أو معترض، لا إلى الـ builder. الـ builder قد يُرجع `path` و`query` فقط.

`receive` لمستهلك واحد. مكرّر ثانٍ يُرفض.

## لقطات الحالة

| العضو                      | المعنى                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `state`                    | `idle` أو `connecting` أو `open` أو `reconnecting` أو `closing` أو `closed` أو `aborted` أو `error` |
| `connection`               | أحدث اتصال مادي: `generation`، وURL، والبروتوكول المتفاوض، والامتدادات عند التوفر                   |
| `bufferedAmount`           | عدد البايتات الأصلية غير المرسلة، أو `0` بلا مقبس مادي                                              |
| `receive`                  | قابل للتكرار غير متزامن لمستهلك واحد من الرسائل الواردة المتحقَّق منها                              |
| `onStateChange(listener)`  | اشترك في انتقالات الحالة المنطقية؛ يُرجع إلغاء الاشتراك                                             |
| `onRuntimeError(listener)` | اشترك في أخطاء وقت التشغيل غير بدء التشغيل؛ يُرجع إلغاء الاشتراك                                    |
| `closed`                   | وعد لنتيجة الإغلاق النهائي المنطقي                                                                  |

`open` = المقبس المادي مفتوح. `reconnecting` يشمل التحضير + التأخير قبل البديل. `connection.generation` يزيد لكل مقبس مادي يصل إلى `open`. `startupConnection` في الـ tuple تبقى أول لقطة ناجحة؛ و`session.connection` يتحرك للأمام.

فشل البدء → `[error, undefined, connection?]`. فشل المُنشئ قبل الفتح قد يكون بلا اتصال؛ والمهلة/الإغلاق أثناء البدء قد يوفّران لقطة. بعد إرجاع الجلسة، تسير أخطاء وقت التشغيل عبر المراقبين و`receive` و`closed` — لا عبر tuple تنفيذ ثانٍ.

```typescript twoslash
import type { Fault, WebSocketConnectionInfo, WebSocketSession } from '@defjs/core'

type SocketResult<TIncoming, TOutgoing> =
  | [error: null, session: WebSocketSession<TIncoming, TOutgoing>, connection: WebSocketConnectionInfo]
  | [error: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const result: SocketResult<unknown, never> | undefined = undefined
void result
```

## أعد الاتصال

إعادة الاتصال اختيارية. بلا كائن `reconnect` → الإغلاق المادي ينهي الجلسة المنطقية. عند الضبط، الافتراضات هي `attempts: 3` و`delayMs: 1000` و`factor: 2` و`maxDelayMs: 30000` و`jitter: 0`. `attempts` يعدّ إعادات المحاولة بعد المحاولة الأولية؛ و`attempts: 0` يعطّل. المسند الافتراضي يقبل كل نتيجة إغلاق.

```ts
import { createClient, defineWebSocket, struct, withEndpoint, withWebSocketReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://chat.example.com'),
  withWebSocketReconnect({
    attempts: 3,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldReconnect({ attempt, code, wasClean }) {
      return attempt <= 3 && (wasClean !== true || code === 1006)
    },
  }),
)
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
})
const [error, session] = await client.execute(room())
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`shouldReconnect` يحصل على محاولة إعادة المحاولة التالية وسبب الإغلاق والرمز والسبب و`wasClean`. `session.close(...)` اليدوي لا يدخل المسند. رمي التحضير/السياسة ينهي الجلسة المنطقية بخطأ.

تذبذب تراجع WebSocket **ضربي** (`jitter: 0.2` → تأخير بين `0.8x` و`1.2x`). تذبذب SSE عامل ضربي بين 0 و1، مثل WebSocket. قيم التأخير/المعامل/التذبذب/المحاولة تُتحقق قبل المُنشئ؛ وتأخيرات المؤقت لا يمكن أن تتجاوز `2_147_483_647` مللي ثانية.

`beforeConnect({ attempt, signal })` يعمل قبل المُنشئ الأولي وكل إعادة اتصال. مرّر إشارته إلى تحديث الرمز حتى يوقف الإلغاء التحضير والاتصال معًا.

## نبض القلب

اختياري عند التنفيذ أو نطاق العميل. الفاصل يرسل `message()` عبر الـ struct الصادر. `isAck(message)` الاختياري يتعرّف على إقرار — تلك الرسالة تمسح المهلة و**لا** تُسلَّم إلى `receive`.

```ts
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.discriminatedUnion('type', [struct.object({ type: struct.literal('pong'), ok: struct.boolean() })]),
  outgoing: struct.object({ type: struct.literal('ping') }),
})

const [error, session] = await client.execute(room(), {
  heartbeat: {
    intervalMs: 30_000,
    timeoutMs: 10_000,
    message: () => ({ type: 'ping' }),
    isAck: (message) => message.type === 'pong',
  },
})
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`intervalMs` و`timeoutMs` يجب أن يكونا مؤقتين محدودين موجبين ≤ `2_147_483_647`. رسالة النبض يجب أن تكون صالحة للـ struct الصادر. التسلسل والإرسال الأصلي وتصنيف الإقرار وأعطال المهلة قاتلة للجلسة المنطقية — ولا تصبح إعادة اتصال عادية.

## الطوابير

| الإعداد                | القيمة المطلوبة                              | السلوك                                                                                                   |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `maxIncomingQueueSize` | عدد صحيح آمن موجب                            | يحد الرسائل المحلَّلة المنتظرة لـ `receive` والإطارات الخام المنتظرة للتحويل. الفيضان → `state: 'error'` |
| `maxOutgoingQueueSize` | عدد صحيح آمن غير سالب اختياري؛ الافتراضي `0` | FIFO فقط بينما `state === 'reconnecting'`. ممتلئ/معطّل → `send(...)` يرمي                                |

الإطارات الصادرة المصطفّة تُفرَّغ قبل أن ينشر المقبس البديل `open`. الإطارات المرسلة أصلًا على مقبس سابق لا تُعاد تلقائيًا أبدًا. طوابير إعادة الاتصال للرسائل التي ترسلها أثناء إعادة الاتصال — لا لإعادة بناء حالة التطبيق.

فيضان الوارد يمسح التسلسل المعلّق، ويفشل `receive`، ويوقف الجلسة، ويحل `session.closed` بـ `kind: 'error'`. أبقِ المستهلك سريعًا بما يكفي أو ارفع الحد من الحجم/الذاكرة المقاسة.

## البروتوكولات والمصادقة

`protocols` في التعريف، و`withWebSocketProtocols(...)` في العميل، و`protocols` في التنفيذ تضبط قائمة البروتوكول الفرعي للمُنشئ. الأسبقية: التنفيذ → العميل → التعريف. أول قائمة معرّفة تُنسخ للجلسة المنطقية وتُعاد استخدامها عند إعادة الاتصال.

مُنشئات WebSocket في المتصفح لا تقبل رؤوس مصافحة عشوائية، والـ builder لا يمكنه إرجاع `headers` أو `body`. Defjs تحوّل `http:` → `ws:` و`https:` → `wss:`، وترمّز عناصر المسار النائبة مرة واحدة، وتستخدم قواعد الاستعلام نفسها كـ HTTP: قيم قياسية ومفاتيح مكررة افتراضيًا، و`withQuerySerializer` للكائنات المتداخلة، وبلا استدعاء للمُسلسِل عندما لا يوجد استعلام.

`withCredentials(true)` هو بيانات اعتماد Fetch لـ HTTP/SSE — وليست مصادقة WebSocket. استخدم سياسة ملف تعريف ارتباط/جلسة مراجعة، أو بروتوكولًا فرعيًا، أو تذكرة اتصال قصيرة العمر. لا تضع بيانات اعتماد عامة أو أسرارًا طويلة العمر في سلسلة الاستعلام.

## الإغلاق والملكية

`session.close(code?, reason?)` يطلب إغلاقًا نهائيًا ويوقف النبض. الرمز يجب أن يكون `1000` أو `3000..4999`؛ والسبب ≤ 123 بايت UTF-8. وسائط الإغلاق غير الصالحة ترمي قبل تغيير الحالة. استخدمه مع `await session.closed` عندما تحتاج سبب إغلاق يدويًا أو النتيجة النهائية المنطقية.

```typescript twoslash
import type { WebSocketSession } from '@defjs/core'

async function observeSession(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  console.log(ownedSession.state)
}

void observeSession
```

`session.closed` هو لقطة النهاية المنطقية: `'closed'` أو `'aborted'` أو `'error'`، مع `code` / `reason` / `wasClean` أصلي اختياري و`cause` للإلغاء/الخطأ. حقول الإغلاق الأصلية المرصودة تفوز على احتياطي المالك المطلوب.

المتخلّص غير المتزامن القياسي يطلب إغلاقًا أصليًا بأفضل جهد، ثم ينتظر teardown المملوك لـ Defjs لدورة الحياة ومضخة الرسائل والمؤقت والمستمع والطابور ومرجع المقبس. إن لم يُرصد حدث إغلاق خلال ثانية واحدة، يُفرض الـ teardown وقد يرفض المتخلّص بـ `DOMException` اسمه `TimeoutError`؛ وهذا لا يثبت أن اتصال TCP المادي أُغلق. استدعاءات المتخلّص المتكررة تشترك في الـ teardown نفسه. تطبيقات الجلسة الهيكلية المخصصة يجب أن توفّر الآن عقد `[Symbol.asyncDispose](): PromiseLike<void>` نفسه.

## حد GraphQL

Defjs توفّر struct واردًا واحدًا، وstruct صادرًا واحدًا، ودورة حياة جلسة منطقية. وهي **لا** تنفّذ بروتوكول تطبيق WebSocket. ميزات GraphQL-over-WebSocket — تهيئة الاتصال، ومعرّفات العملية، و`next`/`error`/`complete`، والتخلّص، وإعادة تشغيل الاشتراك — خارج العقد الأساسي.

استخدم عميل بروتوكول مثل `graphql-ws` عندما يتطلب الخادم ذلك البروتوكول، أو نمذج الإطارات بـ `defineWebSocket(...)`. ضع بروتوكولًا فرعيًا ثابتًا مثل `graphql-transport-ws` على `protocols`. الـ struct وحده لا يتفاوض دلالات GraphQL.

## وصفات ذات صلة

- [فتح جلسة WebSocket](../recipes/websocket-session.md)
- [استهلاك تدفق SSE](../recipes/consume-sse.md)
