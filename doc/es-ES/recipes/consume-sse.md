---
title: Consumir un stream SSE
description: Abre un stream de eventos tipado, itera una vez, luego cierra y await closed.
---

# Consumir un stream SSE

Un iterador async por stream. Pon `close` + `await stream.closed` en `finally` para que las salidas tempranas no filtren el intento Fetch.

Ver detalles en [SSE](../core/sse.md).

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

SSE no reintenta fallos de red/lectura salvo que actives `withSSEReconnect(...)`. Con un objeto reconnect, `attempts` vale `3` por defecto; `attempts: 0` desactiva el reintento.
