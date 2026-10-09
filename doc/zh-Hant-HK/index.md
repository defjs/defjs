---
title: Defjs
description: Typed HTTP、SSE 同 WebSocket commands，配明確 client 同 error-first results。
---

# Defjs

Define 一個 endpoint，build 一個 opaque command，然後 execute。HTTP、SSE、WebSocket 同一套形狀。

```ts get-health.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getHealth = defineRequest({
  method: 'GET',
  path: '/health',
  output: struct.object({ ok: struct.boolean() }),
})

const [error, result, response] = await client.execute(getHealth())
if (!error) console.log(result.ok, response.status)
```

Defjs 唔會幫你 cache results、自動 retry，亦唔會喺你忘記時幫你 close streams。Cancellation 同 cleanup 係你自己嘅責任。

## 揀傳輸方式

| 你需要                            | 由呢度開始                        | 成功時嘅 result                              |
| --------------------------------- | --------------------------------- | -------------------------------------------- |
| Request + 按 status 分嘅 response | [HTTP](./core/http.md)            | Decoded data + `HttpResponse`                |
| 長駐嘅 server event feed          | [SSE](./core/sse.md)              | 一條 stream + startup `open` snapshot        |
| Bidirectional session             | [WebSocket](./core/web-socket.md) | 一個 session + startup `connection` snapshot |

第一次嚟？先睇 [Getting Started](./guide/getting-started.md)，再拎一篇 [recipe](./recipes/get-declared-404.md)。想知「點解」？run 完先再睇 [Design Decisions](./guide/design-decisions.md)。

## 揀 package

| Package                       | 幾時用                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `@defjs/core`                 | `createClient`（HTTP + SSE + WebSocket）                                              |
| `@defjs/react`                | `ClientProvider` / `useClient` — 睇 [React](./plugins/react.md)                       |
| `@defjs/vue`                  | Plugin + `injectClient` — 睇 [Vue](./plugins/vue.md)                                  |
| `@defjs/opentelemetry-server` | Outbound spans/metrics — 睇 [OpenTelemetry Server](./plugins/opentelemetry-server.md) |

## Result 形狀

三種傳輸都 return error-first 三項 tuple。位置一樣；意思唔一樣：

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`
- WebSocket → `[error, session, connection]`

Startup 失敗時第二項係 `undefined`。第三項只會喺嗰個 transport 已經產出 response 或 snapshot 時出現。詳情睇 [Errors](./core/errors.md)。

## Ownership 一句講晒

HTTP stale 就 abort。SSE close 完之後 `await stream.closed`。WebSocket close 完之後 `await session.closed`。喺 server 上面，如果 options 會 capture cookies、auth 或 tenant data，就喺 request boundary 入面 create client。Log 之前先 redact URLs、headers 同 bodies。

## Related recipes

- [GET with a declared 404](./recipes/get-declared-404.md)
- [POST JSON](./recipes/post-json.md)
- [Cancel an HTTP call](./recipes/cancel-http.md)
- [Consume an SSE stream](./recipes/consume-sse.md)
- [Open a WebSocket session](./recipes/websocket-session.md)
- [Test with a local Fetch handle](./recipes/test-with-handle.md)
