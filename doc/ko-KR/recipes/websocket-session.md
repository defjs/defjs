---
title: WebSocket 세션 열기
description: 연결하고, 타입이 있는 envelope를 하나 보내고, 한 번 받은 뒤 닫고 closed를 await 해요.
---

# WebSocket 세션 열기

각 방향은 struct 하나예요. unsubscribe, `close`, `await session.closed`는 호출하는 쪽이 소유해요. 잘못된 프레임은 `onRuntimeError`로 가요.

자세한 내용은 [WebSocket](../core/web-socket.md)을 보세요.

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

재연결은 opt-in이에요 (`withWebSocketReconnect`). Heartbeat도 opt-in이에요. 브라우저 WebSocket은 임의 handshake 헤더를 받을 수 없어요. 쿠키, 서브프로토콜, 또는 짧은 수명의 티켓을 쓰세요.
