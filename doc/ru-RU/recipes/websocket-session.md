---
title: Открыть WebSocket-сессию
description: Подключись, отправь один типизированный envelope, получи один раз, потом close и await closed.
---

# Открыть WebSocket-сессию

Каждое направление — один struct. Unsubscribe, `close` и `await session.closed` — на тебе. Невалидные кадры идут в `onRuntimeError`.

Подробности — в [WebSocket](../core/web-socket.md).

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

Reconnect — opt-in (`withWebSocketReconnect`). Heartbeat тоже. Браузерные WebSocket’ы не принимают произвольные handshake-заголовки — используй cookies, subprotocols или short-lived ticket.
