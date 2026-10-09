---
title: Client
description: Expliziten Client erzeugen, Options komponieren, Commands ausführen und Cleanup besitzen.
---

# Client

Ein `Client` hält Endpoint- + Transport-Config und dispatcht HTTP-, SSE- und WebSocket-Commands. Er cached nicht, auto-retried nicht und babysittet keine offenen Streams.

## Basic Setup

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)` gibt Overloads für jede Command-Art zurück.

## Options komponieren

Options gelten von links nach rechts. Setter ersetzen; `withInterceptors(...items)` hängt an.

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

Gemischte Interceptors werden zur Execute-Zeit nach Transport gefiltert; relative Order unter der gewählten Art bleibt.

## Nach Transport ausführen

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]` (`open` ist der Startup-Snapshot; `stream.open` kann nach Reconnect wechseln)
- WebSocket → `[error, session, connection]`

WebSocket-Execute kann `beforeConnect`, `heartbeat`, `protocols` und `reconnect` überschreiben. `timeout` muss eine positive Safe Integer in `1..2_147_483_647` sein.

Du besitzt Cleanup: HTTP aborten, SSE schließen + `await stream.closed`, WebSocket schließen + `await session.closed`.

## Test-Transport injizieren

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

## Scope auf Server vs Browser

Auf einem Server erzeuge den Client innerhalb der Request-Grenze, wenn Options oder Interceptor-Closures Auth, Cookies, User oder Tenants erfassen. Client-Identität ist für sich keine Security-Grenze.

## Reference

| Helper                                                                                                        | Effect                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | Absoluter Base-Endpoint für alle Transports                            |
| `withHeaders(HeadersInit)`                                                                                    | Statische Default-Headers für HTTP/SSE; Command-Headers überschreiben  |
| `withTimeout(ms)`                                                                                             | Nur Default-HTTP-`execute`-Timeout (SSE/WS ignorieren ihn)             |
| `withHTTPHandle(fetch)`                                                                                       | Fetch für HTTP ersetzen                                                |
| `withSSEHandle(fetch)`                                                                                        | Fetch für SSE ersetzen                                                 |
| `withWebSocketHandle(WebSocket)`                                                                              | WebSocket-Constructor ersetzen                                         |
| `withInterceptors(...items)`                                                                                  | Gemischte Interceptors anhängen                                        |
| `withQuerySerializer(fn)`                                                                                     | Ein schon alias-encodiertes Query-Object in einen Query-String encoden |
| `withCredentials(boolean)`                                                                                    | Fetch `credentials: 'include'` für HTTP/SSE wenn true                  |
| `withXSRF(options?)`                                                                                          | HTTP XSRF Cookie → Header                                              |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | SSE-Knobs                                                              |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | WebSocket-Knobs                                                        |

## Verwandte Rezepte

- [Mit lokalem Fetch-Handle testen](../recipes/test-with-handle.md)
- [HTTP-Aufruf abbrechen](../recipes/cancel-http.md)
