---
title: 打开 WebSocket 会话
description: 连上、发一个类型化信封、收一次，再 close 并 await closed。
---

# 打开 WebSocket 会话

每个方向一个 struct。退订、`close`、`await session.closed` 都归你。非法 frame 进 `onRuntimeError`。

细节见 [WebSocket](../core/web-socket.md)。

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

重连是可选的（`withWebSocketReconnect`）。Heartbeat 也是可选的。浏览器 WebSocket 不能随便塞握手 headers——用 cookie、子协议或短命 ticket。
