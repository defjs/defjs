---
title: Ouvrir une session WebSocket
description: Connecte, envoie une enveloppe typée, reçois une fois, puis ferme et attends closed.
---

# Ouvrir une session WebSocket

Chaque direction est un struct. Tu possèdes le désabonnement, `close` et `await session.closed`. Les frames invalides vont à `onRuntimeError`.

Voir [WebSocket](../core/web-socket.md) pour les détails.

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

Le reconnect est opt-in (`withWebSocketReconnect`). Le heartbeat aussi. Les WebSockets navigateur ne peuvent pas prendre d’en-têtes de handshake arbitraires — utilise cookies, sous-protocoles ou un ticket de courte durée.
