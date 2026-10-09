---
title: Interceptores
description: Capas de política HTTP, SSE y WebSocket en el límite de transporte en orden cebolla.
---

# Interceptores

Añade cabeceras de auth, cortocircuita ventanas de mantenimiento o reintenta lecturas seguras — sin tocar la validación del comando. Cada transporte tiene su propia cadena. Recibes un `HttpRequest`; devuelves el resultado de ese transporte (`HttpResponse`, handle de event-stream o sesión WebSocket). La validación de entrada corre antes de la cadena; el despacho por estado y los resultados decodificados, después.

## Basic Setup

```typescript twoslash
import { createClient, createHttpInterceptor, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit))
void client
```

## Orden cebolla

`withInterceptors(...items)` acepta interceptores mixtos. El cliente filtra por `kind` para el transporte seleccionado y conserva el orden relativo de registro. Cada interceptor puede ejecutarse antes y después de `next`:

| Factory                      | Solicitud     | Resultado de `next`                   |
| ---------------------------- | ------------- | ------------------------------------- |
| `createHttpInterceptor`      | `HttpRequest` | `Promise<HttpResponse<unknown>>`      |
| `createSSEInterceptor`       | `HttpRequest` | `Promise<EventStreamHandle<unknown>>` |
| `createWebSocketInterceptor` | `HttpRequest` | `Promise<WebSocketSessionLike>`       |

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

const order: string[] = []
const first = createHttpInterceptor(async (request, next) => {
  order.push('first:before')
  const response = await next(request)
  order.push('first:after')
  return response
})

const second = createHttpInterceptor(async (request, next) => {
  order.push('second:before')
  const response = await next(request)
  order.push('second:after')
  return response
})

// Request: first:before → second:before → transport
// Return: second:after → first:after
void [first, second, order]
```

Varias llamadas a `withInterceptors(...)` añaden. Pon la observación amplia fuera de la mutación/retry más estrecha cuando la capa exterior deba ver el resultado final.

## Clonar y añadir cabeceras de solicitud

Trata el `HttpRequest` entrante como propiedad de la cadena. Clona `Headers` antes de cambiarlas; pasa una solicitud nueva a `next`:

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

function readAccessToken(): string | undefined {
  return undefined
}

const bearer = createHttpInterceptor((request, next) => {
  const token = readAccessToken()
  if (!token) return next(request)

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return next({ ...request, headers })
})
```

El mismo patrón para SSE. El WebSocket del navegador no puede añadir cabeceras arbitrarias de handshake — cambiar `request.headers` no autenticará un socket del navegador. Usa protocolo, política de URL/query o un handshake soportado por el servidor.

Al reemplazar un cuerpo HTTP, reemplaza `body` en la solicitud copiada. Fetch ignora metadatos de content-type obsoletos cuando cambió el valor del cuerpo. No reutilices un cuerpo `ReadableStream` consumido.

## Cortocircuitar una solicitud

Puedes saltarte `next`, pero debes devolver el tipo de resultado esperado. Para HTTP, `makeResponse(...)` construye un wrapper compatible:

```typescript twoslash
import { createHttpInterceptor, makeResponse } from '@defjs/core'

function isMaintenanceWindow(): boolean {
  return false
}

const maintenanceGate = createHttpInterceptor(async (_request, next) => {
  if (isMaintenanceWindow()) {
    return makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { message: 'Temporarily unavailable' },
    })
  }

  return next(_request)
})
```

La capa de comando sigue despachando por estado. Declara un único struct `error` para el lado no-2xx cuando los llamadores necesiten `error.data` tipado. Cortocircuitar SSE o WebSocket necesita un handle/sesión compatible completo (promesas de cierre, estado en vivo, ownership y `[Symbol.asyncDispose]`). Los objetos parciales no son política válida. Las implementaciones estructurales de `EventStreamHandle` y `WebSocketSessionLike` ahora necesitan ese disposer estándar en tiempo de compilación; quien solo recibe handles de Defjs no tiene un requisito nuevo de llamada en runtime.

## Reintentar lecturas seguras

Los reintentos cambian el comportamiento. Mantén la política estrecha — este ejemplo reintenta `GET` / `HEAD` / `OPTIONS` reproducibles para estados `0`, `429`, `502`, `503`, `504`, limita `Retry-After` a 30s y para tras dos reintentos o en abort:

```typescript twoslash
import { createHttpInterceptor, type HttpRequest, type HttpResponse } from '@defjs/core'

const retryableMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const retryableStatuses = new Set([0, 429, 502, 503, 504])

function isReplayable(request: HttpRequest): boolean {
  return typeof ReadableStream === 'undefined' || !(request.body instanceof ReadableStream)
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get('retry-after')
  if (!value) return 250

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000)

  const date = Date.parse(value)
  return Number.isNaN(date) ? 250 : Math.min(Math.max(0, date - Date.now()), 30_000)
}

function waitForRetryAfter(response: HttpResponse<unknown>, signal?: AbortSignal): Promise<void> {
  const delay = retryAfterMs(response)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(done, delay)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason)
    }

    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (!retryableMethods.has(request.method.toUpperCase()) || !isReplayable(request)) return next(request)

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request)
    if (!retryableStatuses.has(response.status) || attempt >= 2) return response
    await waitForRetryAfter(response, request.abort)
  }
})
```

Los errores lanzados de interceptor/Fetch no se reintentan en este bucle: un fallo de transporte rechaza en lugar de producir un estado con el que este bucle pudiera coincidir. Reintentar `POST` / `PUT` / `PATCH` / `DELETE` necesita bytes reproducibles, soporte del servidor, un contrato de idempotencia y una política de estado revisada. El reintento es tuyo: Core no exporta `retryAfter()`.

Un interceptor que lanza (o rechaza) fuera de este ejemplo llega a quien llama como
`EXT_INTERCEPTOR_FAILED`, con el valor lanzado en `cause` — mira [Errores](./errors.md). Lanzar
`ERR_ABORTED` o `ERR_TIMEOUT` es, en cambio, la forma en que un interceptor expresa la cancelación.

`next(request)` puede rechazar. Un fallo de transporte es un fault, no una respuesta con estado 0,
así que un interceptor que quiera observarlo pone `try` / `catch` alrededor de `next`. Defjs sigue
atribuyéndolo bien: un rechazo que vino del transporte sigue siendo un fault `NET_*` y no se le echa
la culpa a tu interceptor.

## Envolver sesiones WebSocket

Un interceptor WebSocket puede llamar a `next` como máximo una vez. Si envuelves la sesión, delega getters en vivo y miembros del ciclo de vida de forma explícita:

```typescript twoslash
import { createWebSocketInterceptor } from '@defjs/core'

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request)

  return {
    get bufferedAmount() {
      return session.bufferedAmount
    },
    get connection() {
      return session.connection
    },
    get state() {
      return session.state
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason)
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]()
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener)
    },
    onStateChange(listener) {
      return session.onStateChange(listener)
    },
    send(message: unknown) {
      session.send(message)
    },
  }
})
```

Expandir una sesión congela `state` / `connection` / `bufferedAmount` una vez. Conserva `closed`, `receive`, `close`, la delegación exacta de `[Symbol.asyncDispose]()` y la limpieza de listeners salvo que cambies deliberadamente el ownership. Un wrapper debe devolver la promise de teardown de la sesión interna, no una promise resuelta ajena. Si una cadena crea una sesión que no se entrega, Core la asienta y la cierra; si un interceptor con éxito devuelve otra sesión, Core descarta la creada.

## Reference

Las factories devuelven valores de transporte etiquetados:

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — credenciales Basic en HTTP
- `basicAuthSSEInterceptor(provider, options?)` — credenciales Basic en SSE

`HttpRequest` puede incluir `endpoint`, `baseEndpoint`, `method`, `headers`, `body`, `queryParams`, `queryString`, `abort`, `timeout` y `operation` estático. Es un valor de integración de transporte — no la entrada parseada del llamador. `queryParams` es `new URLSearchParams(queryString)` después de la serialización. Un serializador de query configurado no se llama cuando el builder no produjo query, y un `URLSearchParams` del builder se usa tal cual. Mantén la validación del comando, la validación de salida y el mapeo de errores de dominio en sus capas.

Los observadores SSE/WebSocket son hooks de ciclo de vida, no control de flujo. Haz unsubscribe de los listeners WebSocket cuando termine el dueño. Los fallos del observador siguen el contrato del transporte; un interceptor en sí puede lanzar o rechazar.

Registra un allowlist revisado: `operation` estático, método, estado, duración, código de error estable. No registres por defecto URL resueltas, query strings, cabeceras de auth, cuerpos, causes en bruto, IDs de eventos SSE ni payloads WebSocket.

Las credenciales Basic son base64, no cifrado. Usa TLS, mantén los providers de credenciales acotados a la solicitud en un servidor, nunca registres la cabecera generada. El encoder por defecto es `globalThis.btoa`; pasa `BasicAuthInterceptorOptions.encode` cuando el runtime no tenga `btoa` o necesite un encoder revisado.

Un interceptor puede imponer política de transporte. No es validación de entrada, autorización ni ownership de recursos. El código que arranca trabajo de larga duración sigue usando `await using` o cierra y espera manualmente la promesa terminal. HTTP ordinario sigue siendo request-scoped y se gestiona con su timeout / `AbortSignal`; `Client` no es `AsyncDisposable`.

## Recetas relacionadas

- [Refrescar un token Bearer una vez ante un 401](../recipes/refresh-bearer-once.md)
- [Publicar un SDK HTTP sin ocultar execute](../recipes/publish-http-sdk.md)
- [Probar con un handle Fetch local](../recipes/test-with-handle.md)
- [Cancelar una llamada HTTP](../recipes/cancel-http.md)
