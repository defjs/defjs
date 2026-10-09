---
title: 開一個 WebSocket session
description: Connect，send 一個 typed envelope，receive 一次，之後 close 同 await closed。
---

# 開一個 WebSocket session

每個方向係一個 struct。Unsubscribe、`close`，同 `await session.closed` 都係你 own。Invalid frames 去 `onRuntimeError`。

詳情睇 [WebSocket](../core/web-socket.md)。

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

Reconnect 係 opt-in（`withWebSocketReconnect`）。Heartbeat 都係 opt-in。Browser WebSockets 唔可以拎 arbitrary handshake headers — 用 cookies、subprotocols，或者 short-lived ticket。
