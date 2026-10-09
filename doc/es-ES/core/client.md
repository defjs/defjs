---
title: Cliente
description: Crea un cliente explícito, compón opciones, ejecuta comandos y gestiona la limpieza.
---

# Cliente

Un `Client` guarda la config de endpoint + transporte y despacha comandos HTTP, SSE y WebSocket. No cachea, no reintenta solo ni cuida streams abiertos.

## Basic Setup

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)` devuelve sobrecargas para cada tipo de comando.

## Componer opciones

Las opciones se aplican de izquierda a derecha. Los setters reemplazan; `withInterceptors(...items)` añade.

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

Los interceptores mixtos se filtran por transporte en el momento de execute; el orden relativo entre el tipo seleccionado se conserva.

## Ejecutar por transporte

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]` (`open` es el snapshot de arranque; `stream.open` puede cambiar tras reconnect)
- WebSocket → `[error, session, connection]`

El execute de WebSocket puede sobrescribir `beforeConnect`, `heartbeat`, `protocols` y `reconnect`. `timeout` debe ser un entero seguro positivo en `1..2_147_483_647`.

Tú gestionas la limpieza: aborta HTTP, cierra SSE + `await stream.closed`, cierra WebSocket + `await session.closed`.

## Inyectar un transporte de prueba

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

## Ámbito en servidor vs navegador

En un servidor, crea el cliente dentro del límite de la solicitud cuando las opciones o clausuras de interceptor capturan auth, cookies, usuarios o tenants. La identidad del cliente no es por sí sola un límite de seguridad.

## Reference

| Helper                                                                                                        | Efecto                                                               |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | Endpoint base absoluto para todos los transportes                    |
| `withHeaders(HeadersInit)`                                                                                    | Cabeceras estáticas por defecto para HTTP/SSE; las del comando ganan |
| `withTimeout(ms)`                                                                                             | Timeout por defecto solo de `execute` HTTP (SSE/WS lo ignoran)       |
| `withHTTPHandle(fetch)`                                                                                       | Reemplazar Fetch para HTTP                                           |
| `withSSEHandle(fetch)`                                                                                        | Reemplazar Fetch para SSE                                            |
| `withWebSocketHandle(WebSocket)`                                                                              | Reemplazar el constructor WebSocket                                  |
| `withInterceptors(...items)`                                                                                  | Añadir interceptores mixtos                                          |
| `withQuerySerializer(fn)`                                                                                     | Codifica un objeto de query ya con alias en un query string          |
| `withCredentials(boolean)`                                                                                    | Fetch `credentials: 'include'` para HTTP/SSE cuando es true          |
| `withXSRF(options?)`                                                                                          | Cookie XSRF HTTP → cabecera                                          |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | Controles SSE                                                        |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | Controles WebSocket                                                  |

## Recetas relacionadas

- [Probar con un handle Fetch local](../recipes/test-with-handle.md)
- [Cancelar una llamada HTTP](../recipes/cancel-http.md)
