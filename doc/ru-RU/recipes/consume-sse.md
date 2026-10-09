---
title: Читать SSE-стрим
description: Открой типизированный event stream, итерируй один раз, потом close и await closed.
---

# Читать SSE-стрим

Один async iterator на стрим. Клади `close` + `await stream.closed` в `finally`, чтобы ранний выход не утекал Fetch-попыткой.

Подробности — в [SSE](../core/sse.md).

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

SSE не ретраит сбои сети и чтения, пока не включишь `withSSEReconnect(...)`. Если объект reconnect задан, `attempts` по умолчанию `3`; `attempts: 0` отключает ретрай.
