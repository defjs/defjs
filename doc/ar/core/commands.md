---
title: الأوامر
description: عرّف نقاط النهاية، ابنِ أوامر معتمة، عيّن المدخلات، واستنتج نتائج النقل.
---

# الأوامر

تعريف واحد → نقطة نهاية → أمر معتم → `client.execute`. نفس المسار لـ HTTP وSSE وWebSocket.

## الإعداد الأساسي

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## اختر تعريفًا

| التعريف                  | العقد                                                          | القيمة عند النجاح                    |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------ |
| `defineRequest(...)`     | الطريقة، مسار نسبي، مدخل اختياري، `output` / `error` اختياريان | بيانات مفكوكة + استجابة              |
| `defineEventStream(...)` | المسار، حدود المخزن/الطابور، خريطة اسم حدث → Struct            | `EventStreamHandle` + لقطة open      |
| `defineWebSocket(...)`   | المسار، struct وارد واحد، struct صادر اختياري، حد الطابور      | `WebSocketSession` + لقطة connection |

بلا `input` → نقطة النهاية لا تأخذ وسيطًا، ويجوز أن يكون `builder` هو `() => request`. مع `input` → مرّر قيمة الـ struct. الحقل الاختياري يجوز حذفه؛ والحقل المطلوب لا يجوز.

أبقِ الأوامر معتمة. لا تحفر في العلامات أو الرموز.

## أين تذهب القيم

الـ struct يقرر كيف تُرمَّز القيمة. والـ `builder` يقرر أين تذهب. `builder` دالة نقية متزامنة للمدخل **المحلَّل**. يعمل وقت التنفيذ. الرمي يصبح `REQ_BUILD_FAILED` على الـ tuple — واستدعاء نقطة النهاية نفسه لا يرمي.

احذف `builder` عندما يكون struct المدخل أصلًا `{ path?, query?, headers?, body? }`. تلك هي المطابقة `(input) => input`. إن لم يكن المدخل المحلَّل قابلًا للإسناد إلى ذلك الشكل، يطلب TypeScript `builder`.

سلّم القيمة المُنوَّعة. ثم ينطبق alias، و`Date` → ISO، و`bigint` → سلسلة في كل موضع يُستخدم فيه ذلك الـ struct: وضع الطلب، وفك الاستجابة، وأحداث SSE، وإطارات WebSocket.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
  email: struct.string(),
})

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({ user: User }),
  builder: (input) => ({ body: input.user }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})
void createUser
```

الجسم هو JSON `{"display_name":"…","email":"…"}`. المفتاح المكتوب يدويًا هو المخرج: `body: { name: input.user.displayName }` يرسل `name`، لأن الكائن الأب مجهول ولا ينطبق الـ alias.

## عندما تختلف الأشكال

استخدم `builder` لعناصر المسار النائبة والحرفيّات والتفرعات. يستقبل القيمة الحقيقية، فتعمل `if` و`??` والقوالب و`switch`.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const search = defineRequest({
  method: 'GET',
  path: '/orgs/:org_id/users',
  input: struct.object({
    orgId: struct.number(),
    query: struct.object({
      keyword: struct.string(),
      pageSize: struct.number().alias('page_size'),
    }),
  }),
  builder: (input) => ({
    path: { org_id: input.orgId },
    query: input.query,
    headers: { 'x-api-version': '2' },
  }),
  output: struct.object({ items: struct.array(struct.string()) }),
})
void search
```

`query: input.query` يرسل `page_size`. `headers: { 'x-api-version': '2' }` حرفي. المصادقة والتتبّع ما زالا ينتميان إلى المعترضات: فهي ترى الطلب الأصلي بعد أن يعمل الـ builder.

## أشكال `output` و`error`

`output` هو Struct واحد لجسم 2xx؛ و`error` هو Struct واحد لكل ما عداه. و`ok` هو نقطة التفرّع الوحيدة، ولا يُفكّ إلا طرف واحد. وحذف أحد الطرفين يعني أن ذلك الجسم لا يُقرأ أبدًا: الخطأ يحمل الحالة، و`data` يبقى `undefined`.

## وصفات ذات صلة

- [GET مع 404 معلَن](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
