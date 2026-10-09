---
title: SSE-Stream konsumieren
description: Typisierten Event-Stream öffnen, einmal iterieren, dann schließen und closed awaiten.
---

# SSE-Stream konsumieren

Ein Async-Iterator pro Stream. Packe `close` + `await stream.closed` in `finally`, damit frühe Exits den Fetch-Versuch nicht leaken.

Details siehe [SSE](../core/sse.md).

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

SSE retried Network-/Read-Failures nicht, außer du aktivierst `withSSEReconnect(...)`. Mit einem Reconnect-Object ist der Default für `attempts` `3`; `attempts: 0` disabled Retry.
