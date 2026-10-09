---
title: Клиент
description: Создай явный клиент, собери опции, выполни команды и владей cleanup.
---

# Клиент

`Client` держит эндпоинт + конфиг транспорта и диспатчит команды HTTP, SSE и WebSocket. Он не кеширует, не auto-retry и не нянчит открытые стримы.

## Базовая настройка

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)` возвращает перегрузки под каждый вид команды.

## Собери опции

Опции применяются слева направо. Setters заменяют; `withInterceptors(...items)` дописывает.

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

Смешанные interceptors фильтруются по транспорту в момент execute; относительный порядок среди выбранного kind сохраняется.

## Execute по транспорту

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]` (`open` — снимок старта; `stream.open` может меняться после reconnect)
- WebSocket → `[error, session, connection]`

WebSocket execute может переопределить `beforeConnect`, `heartbeat`, `protocols` и `reconnect`. `timeout` — положительное safe integer в `1..2_147_483_647`.

Cleanup на тебе: abort HTTP, close SSE + `await stream.closed`, close WebSocket + `await session.closed`.

## Подставь тестовый транспорт

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

## Scope на сервере vs в браузере

На сервере создавай клиент внутри границы запроса, когда опции или замыкания interceptor’ов захватывают auth, cookies, пользователей или tenants. Идентичность клиента сама по себе — не security boundary.

## Справка

| Helper                                                                                                        | Эффект                                                                |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | Абсолютный base endpoint для всех транспортов                         |
| `withHeaders(HeadersInit)`                                                                                    | Статические default headers для HTTP/SSE; headers команды перекрывают |
| `withTimeout(ms)`                                                                                             | Только default timeout HTTP `execute` (SSE/WS его игнорируют)         |
| `withHTTPHandle(fetch)`                                                                                       | Заменить Fetch для HTTP                                               |
| `withSSEHandle(fetch)`                                                                                        | Заменить Fetch для SSE                                                |
| `withWebSocketHandle(WebSocket)`                                                                              | Заменить конструктор WebSocket                                        |
| `withInterceptors(...items)`                                                                                  | Дописать смешанные interceptors                                       |
| `withQuerySerializer(fn)`                                                                                     | Закодировать уже алиаснутый query-объект в query-строку               |
| `withCredentials(boolean)`                                                                                    | Fetch `credentials: 'include'` для HTTP/SSE при true                  |
| `withXSRF(options?)`                                                                                          | HTTP XSRF cookie → header                                             |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | Крутилки SSE                                                          |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | Крутилки WebSocket                                                    |

## Связанные рецепты

- [Тест с локальным Fetch handle](../recipes/test-with-handle.md)
- [Отменить HTTP-вызов](../recipes/cancel-http.md)
