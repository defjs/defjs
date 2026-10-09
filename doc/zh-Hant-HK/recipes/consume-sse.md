---
title: Consume 一條 SSE stream
description: 開 typed event stream，iterate 一次，之後 close 同 await closed。
---

# Consume 一條 SSE stream

每條 stream 淨係一個 async iterator。將 `close` + `await stream.closed` 放喺 `finally`，提早 exit 都唔會 leak Fetch attempt。

詳情睇 [SSE](../core/sse.md)。

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

除非你開 `withSSEReconnect(...)`，否則 SSE 唔會 retry network/read failures。有 reconnect object 嘅時候，`attempts` 預設係 `3`；`attempts: 0` 關閉 retry。
