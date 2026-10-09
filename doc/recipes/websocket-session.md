---
title: Open a WebSocket session
description: Connect, send one typed envelope, receive once, then close and await closed.
---

# Open a WebSocket session

Each direction is one struct. You own unsubscribe, `close`, and `await session.closed`. Invalid frames go to `onRuntimeError`.

See [WebSocket](../core/web-socket.md) for details.

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

Reconnect is opt-in (`withWebSocketReconnect`). Heartbeat is opt-in too. Browser WebSockets can’t take arbitrary handshake headers — use cookies, subprotocols, or a short-lived ticket.
