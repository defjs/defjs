---
title: استهلاك تدفق SSE
description: افتح تدفق أحداث مُنوَّعًا، كرّر مرة واحدة، ثم أغلق وانتظر closed.
---

# استهلاك تدفق SSE

مكرّر غير متزامن واحد لكل تدفق. ضع `close` + `await stream.closed` في `finally` حتى لا تسرّب محاولة Fetch عند الخروج المبكر.

انظر [SSE](../core/sse.md) للتفاصيل.

```ts twoslash notifications.ts
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
  try {
    for await (const event of stream) {
      if (event.event === 'message') {
        console.log(event.data.text)
        break
      }
    }
  } finally {
    stream.close('consumer-finished')
    await stream.closed
  }
}
```

```txt
hello from the server
```

لا تعيد SSE المحاولة عند فشل الشبكة أو القراءة افتراضيًا. فعّل ذلك صراحةً باستخدام `withSSEReconnect(...)`. عند ضبط reconnect تكون القيمة الافتراضية لـ `attempts` هي `3`؛ وتعطّل `attempts: 0` إعادة المحاولة.
