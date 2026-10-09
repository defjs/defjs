---
title: 開啟 WebSocket session
description: 連線、送一個型別化 envelope、收一次，然後 close 並 await closed。
---

# 開啟 WebSocket session

每個方向各一個 struct。Unsubscribe、`close`、`await session.closed` 由你負責。無效 frames 走 `onRuntimeError`。

細節見 [WebSocket](../core/web-socket.md)。

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

重連是選擇性開啟（`withWebSocketReconnect`）。Heartbeat 也是。瀏覽器 WebSocket 不能帶任意 handshake headers — 改用 cookies、subprotocols，或短效 ticket。
