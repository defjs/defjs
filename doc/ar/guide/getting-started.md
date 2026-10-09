---
title: 'البدء: طلب HTTP واحد'
description: عرّف GET /users/:id، شغّله ضد معالج Fetch محلي، ثم وجّهه إلى API حقيقي.
---

# البدء: طلب HTTP واحد

ستعرّف `GET /users/:id`، وتنفّذه عبر عميل صريح، وتفكك `200` و`404` المعلَن معًا. المعالج المحلي يبقي أول تشغيل دون شبكة؛ الأمر يبقى كما هو عندما تستبدل بخدمة حقيقية.

## الخطوة 1 — التثبيت

`@defjs/core` هو ESM ويحتاج Node.js 22+ أو Bun أو Deno. Node يشغّل ملف `.ts` مباشرة — ضع `"type": "module"` في package.json. في المتصفح ما زلت تحتاج المُجمّع وFetch.

::: tabs
== bun

```sh
bun add @defjs/core
```

== npm

```sh
npm install @defjs/core
```

== pnpm

```sh
pnpm add @defjs/core
```

== yarn

```sh
yarn add @defjs/core
```

== deno

```sh
deno add npm:@defjs/core
```

:::

## الخطوة 2 — عرّف الطلب

أنشئ `src/get-user.ts`. struct المدخل هو قيمة المستدعي. `builder` يضع تلك القيمة على الطلب. هنا المدخل كله هو كائن المسار، فالحقول القياسية بلا alias تملأ `:id`.

```ts get-user.ts
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
})

const NotFound = struct.object({
  message: struct.string(),
})

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
  error: NotFound,
})

const command = getUser({ id: 7 })
void command
```

`output` هو جسم 2xx. `error` هو كل حالة أخرى. struct واحد لكل منهما. استخدم `struct.or(...)` أو اتحادًا مميّزًا عندما تختلف تلك الأجسام.

`defineRequest(...)` يُرجع نقطة نهاية. استدعاء `getUser(...)` يبني الأمر المعتم الذي ستمرّره إلى `client.execute(...)`. الـ `builder` أعلاه هو الدالة التي تضع المدخل؛ وليس نقطة النهاية.

## الخطوة 3 — نفّذه محليًا

اربط معالج Fetch محليًا للعميل لتشغّل بلا شبكة. Defjs ما زالت تتحقق من المدخل، وتبني `Request`، وتوزّع حسب الحالة، وتحلّل الجسم.

```ts get-user.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
})

const NotFound = struct.object({
  message: struct.string(),
})

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
  error: NotFound,
})

const handle: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const id = new URL(request.url).pathname.split('/').at(-1)

  if (id === '7') {
    return Response.json({ id: 7, name: 'Ada' }, { status: 200 })
  }

  return Response.json({ message: 'User not found' }, { status: 404 })
}

const client = createClient(withEndpoint('https://api.example.test'), withHTTPHandle(handle))

const [error, user, response] = await client.execute(getUser({ id: 7 }), {
  timeout: 5_000,
})

if (error) {
  if (error.code === 'HTTP_STATUS' && error.status === 404) {
    console.log(error.data.message)
  } else {
    console.error(error.code)
  }
} else {
  console.log(`Loaded ${user.name} from ${response.status}`)
}
```

شغّله:

::: tabs
== bun

```sh
bun src/get-user.ts
```

== npm

```sh
node src/get-user.ts
```

== pnpm

```sh
node src/get-user.ts
```

== yarn

```sh
node src/get-user.ts
```

== deno

```sh
deno run src/get-user.ts
```

:::

```txt
Loaded Ada from 200
```

جرّب مستخدمًا مفقودًا — غيّر معرّف المسار إلى `8` وشغّل مجددًا:

```txt
User not found
```

عند النجاح: `error` هو `null`، و`user` هو مخرج Struct لـ `200`، و`response` هو `HttpResponse`. عند `404` معلَن: `error.code` هو `'HTTP_STATUS'`، و`error.status` هو `404`، و`error.data` مُنوَّع كـ `NotFound`. العنصر الثاني في الـ tuple هو `undefined` عند الفشل.

## الخطوة 4 — وجّه إلى API حقيقي

احذف `withHTTPHandle(...)` وضع عنوان الأساس الحقيقي عندما تنفّذ الخدمة `GET /v1/users/:id` بتلك الأجسام.

```ts
import { createClient, withEndpoint, withHTTPHandle } from '@defjs/core'

const localHandle: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const id = new URL(request.url).pathname.split('/').at(-1)

  if (id === '7') {
    return Response.json({ id: 7, name: 'Ada' }, { status: 200 })
  }

  return Response.json({ message: 'User not found' }, { status: 404 })
}

const localClient = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(localHandle))
const realClient = createClient(withEndpoint('https://api.example.com/v1'))
void localClient
void realClient
```

نفس الأمر. عميل مختلف.

## عندما تختلف النتيجة

- مدخل سيئ → `REQ_INPUT_INVALID`؛ خيارات إلغاء متعارضة → `REQ_OPTIONS_INVALID`؛ فشل
  `build` → `REQ_BUILD_FAILED`
- أي غير-2xx → `HTTP_STATUS`، مع `err.data` مُنوَّع عند إعلان `error`
- نوع وسائط خاطئ → `RES_MEDIA_TYPE_INVALID`، يُبلَّغ قبل قراءة الجسم
- جسم معلَن لا يُفكّ → `RES_DECODE_FAILED` أو `RES_STRUCT_MISMATCH`
- فشل Fetch / إلغاء / مهلة → `NET_UNREACHABLE` / `NET_ABORTED` / `NET_TIMEOUT`

يجب أن يكون `timeout` عددًا صحيحًا آمنًا موجبًا في `1..2_147_483_647`. أشكال الإلغاء الصالحة: `{ timeout }`، `{ abort }`، أو `{ signal, timeout }` / `{ signal, abort }`. `{ abort, timeout }` معًا غير صالح. الإلغاء يخبرك بما رآه المستدعي — لا ما إذا كانت كتابة الخادم قد اكتملت.

## الوصفات التالية

- [GET مع 404 معلَن](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [إلغاء استدعاء HTTP](../recipes/cancel-http.md)
- [استهلاك تدفق SSE](../recipes/consume-sse.md)
- [فتح جلسة WebSocket](../recipes/websocket-session.md)
- [الاختبار بـ Fetch محلي](../recipes/test-with-handle.md)
