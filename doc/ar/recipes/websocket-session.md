---
title: فتح جلسة WebSocket
description: اتصل، أرسل غلافًا مُنوَّعًا واحدًا، استقبل مرة، ثم أغلق وانتظر closed.
---

# فتح جلسة WebSocket

كل اتجاه هو struct واحد. أنت تملك إلغاء الاشتراك و`close` و`await session.closed`. الإطارات غير الصالحة تذهب إلى `onRuntimeError`.

انظر [WebSocket](../core/web-socket.md) للتفاصيل.

```ts twoslash chat.ts
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))

const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
  outgoing: struct.object({ type: struct.literal('send'), text: struct.string() }),
})

const [error, session] = await client.execute(room())
if (error) {
  console.error(error.code)
} else {
  const unsubscribe = session.onRuntimeError((cause) => console.error('runtime', cause))
  try {
    session.send({ type: 'send', text: 'Hello' })
    for await (const message of session.receive) {
      console.log(message.type, message.text)
      break
    }
  } finally {
    unsubscribe()
    session.close(1000, 'consumer-finished')
    await session.closed
  }
}
```

```txt
message Hello
```

إعادة الاتصال اختيارية (`withWebSocketReconnect`). نبض القلب اختياري أيضًا. WebSocket في المتصفح لا يقبل رؤوس مصافحة عشوائية — استخدم ملفات تعريف الارتباط أو البروتوكولات الفرعية أو تذكرة قصيرة العمر.
