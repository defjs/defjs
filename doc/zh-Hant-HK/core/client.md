---
title: Client
description: Create 明確 client，compose options，execute commands，再自己 own cleanup。
---

# Client

`Client` 持有 endpoint + transport config，再 dispatch HTTP、SSE 同 WebSocket commands。佢唔會 cache、auto-retry，亦唔會 babysit open streams。

## Basic Setup

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)` 會為每種 command kind return overloads。

## Compose options

Options 由左到右套用。Setters 會 replace；`withInterceptors(...items)` 會 append。

```typescript twoslash
import { createClient, createHttpInterceptor, withCredentials, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit), withCredentials(true))
void client
```

Mixed interceptors 會喺 execute 時按 transport filter；選中嗰種嘅相對次序會保留。

## 按 transport execute

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`（`open` 係 startup snapshot；reconnect 之後 `stream.open` 可以變）
- WebSocket → `[error, session, connection]`

WebSocket execute 可以 override `beforeConnect`、`heartbeat`、`protocols` 同 `reconnect`。`timeout` 一定要係 `1..2_147_483_647` 入面嘅 positive safe integer。

Cleanup 係你 own：abort HTTP，close SSE + `await stream.closed`，close WebSocket + `await session.closed`。

## Inject 一個 test transport

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
})

const handle: typeof fetch = async () => Response.json({ id: 7, name: 'Ada' })
const client = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(handle))
const [error, user] = await client.execute(getUser({ id: 7 }))
if (!error) console.log(user.name)
```

## Server vs browser 嘅 scope

喺 server 上面，當 options 或者 interceptor closures capture auth、cookies、users 或者 tenants 時，喺 request boundary 入面 create client。Client identity 本身唔係 security boundary。

## Reference

| Helper                                                                                                        | Effect                                                          |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | 所有 transports 嘅 absolute base endpoint                       |
| `withHeaders(HeadersInit)`                                                                                    | HTTP/SSE 嘅 static default headers；command headers 會 override |
| `withTimeout(ms)`                                                                                             | 只係 default HTTP `execute` timeout（SSE/WS 會 ignore）         |
| `withHTTPHandle(fetch)`                                                                                       | 換走 HTTP 嘅 Fetch                                              |
| `withSSEHandle(fetch)`                                                                                        | 換走 SSE 嘅 Fetch                                               |
| `withWebSocketHandle(WebSocket)`                                                                              | 換走 WebSocket constructor                                      |
| `withInterceptors(...items)`                                                                                  | Append mixed interceptors                                       |
| `withQuerySerializer(fn)`                                                                                     | 將已經套咗 alias 嘅 query object encode 成 query string         |
| `withCredentials(boolean)`                                                                                    | 為 true 時，HTTP/SSE 用 Fetch `credentials: 'include'`          |
| `withXSRF(options?)`                                                                                          | HTTP XSRF cookie → header                                       |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | SSE knobs                                                       |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | WebSocket knobs                                                 |

## Related recipes

- [Test with a local Fetch handle](../recipes/test-with-handle.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
