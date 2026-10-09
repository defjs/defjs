---
title: Consume an SSE stream
description: Open a typed event stream, iterate once, then close and await closed.
---

# Consume an SSE stream

One async iterator per stream. Put `close` + `await stream.closed` in `finally` so early exits don’t leak the Fetch attempt.

See [SSE](../core/sse.md) for details.

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

SSE does not retry network/read failures unless you enable `withSSEReconnect(...)`. With a reconnect object, `attempts` defaults to `3`; `attempts: 0` disables retry.
