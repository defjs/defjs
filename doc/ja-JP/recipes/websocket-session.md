---
title: WebSocket セッションを開く
description: 接続し、型付きエンベロープを 1 つ送り、1 つ受け取り、close して closed を await します。
---

# WebSocket セッションを開く

方向ごとに struct は 1 つです。購読解除、`close`、`await session.closed` は呼び出し側の責任です。不正なフレームは `onRuntimeError` へ行きます。

詳細は [WebSocket](../core/web-socket.md) を見てください。

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

再接続はオプトインです（`withWebSocketReconnect`）。ハートビートもオプトインです。ブラウザーの WebSocket は任意のハンドシェイクヘッダーを取れません — cookie、サブプロトコル、短命チケットを使ってください。
