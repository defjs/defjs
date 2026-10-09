---
title: Client
description: Create an explicit client, compose options, execute commands, and own cleanup.
---

# Client

A `Client` holds endpoint + transport config and dispatches HTTP, SSE, and WebSocket commands. It doesn’t cache, auto-retry, or babysit open streams.

## Basic Setup

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)` returns overloads for each command kind.

## Compose options

Options apply left to right. Setters replace; `withInterceptors(...items)` appends.

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

Mixed interceptors are filtered by transport at execute time; relative order among the selected kind stays.

## Execute by transport

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]` (`open` is the startup snapshot; `stream.open` can change after reconnect)
- WebSocket → `[error, session, connection]`

WebSocket execute can override `beforeConnect`, `heartbeat`, `protocols`, and `reconnect`. `timeout` must be a positive safe integer in `1..2_147_483_647`.

You own cleanup: abort HTTP, close SSE + `await stream.closed`, close WebSocket + `await session.closed`.

## Inject a test transport

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

## Scope on server vs browser

On a server, create the client inside the request boundary when options or interceptor closures capture auth, cookies, users, or tenants. Client identity isn’t a security boundary by itself.

## Reference

| Helper                                                                                                        | Effect                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | Absolute base endpoint for all transports                     |
| `withHeaders(HeadersInit)`                                                                                    | Static default headers for HTTP/SSE; command headers override |
| `withTimeout(ms)`                                                                                             | Default HTTP `execute` timeout only (SSE/WS ignore it)        |
| `withHTTPHandle(fetch)`                                                                                       | Replace Fetch for HTTP                                        |
| `withSSEHandle(fetch)`                                                                                        | Replace Fetch for SSE                                         |
| `withWebSocketHandle(WebSocket)`                                                                              | Replace WebSocket constructor                                 |
| `withInterceptors(...items)`                                                                                  | Append mixed interceptors                                     |
| `withQuerySerializer(fn)`                                                                                     | Encode an already-aliased query object into a query string    |
| `withCredentials(boolean)`                                                                                    | Fetch `credentials: 'include'` for HTTP/SSE when true         |
| `withXSRF(options?)`                                                                                          | HTTP XSRF cookie → header                                     |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | SSE knobs                                                     |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | WebSocket knobs                                               |

## Related recipes

- [Test with a local Fetch handle](../recipes/test-with-handle.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
