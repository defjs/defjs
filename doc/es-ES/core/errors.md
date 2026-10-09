---
title: Errores
description: Ramifica sobre un conjunto cerrado de códigos de fault para 404, timeouts, cuerpos ilegibles y fallos de transporte.
---

# Errores

Maneja un 404, un timeout o un cuerpo ilegible leyendo la tupla error-first, no capturando throws. Un `Fault` es un `Error` nativo (`instanceof Error` es true) discriminado por un solo campo: `code`.

No hay `kind`. La clase de un fallo es el segmento antes del primer `_` de su código, así que `NET_TIMEOUT` es un fallo `NET` y `RES_STRUCT_MISMATCH` es un fallo `RES`. Lee el prefijo para el triaje grueso y el código completo para el caso exacto.

## Configuración básica

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [err, user, response] = await client.execute(getUser({ id: 7 }))
if (err?.code === 'HTTP_STATUS' && err.status === 404) {
  console.log(err.data.message)
} else if (err?.code === 'NET_TIMEOUT') {
  console.log('timed out')
} else if (err?.code === 'RES_STRUCT_MISMATCH') {
  console.log('the response did not match what we declared', err.response.status)
} else if (!err) {
  console.log(user.name, response.status)
}
```

Como el conjunto es cerrado, un `switch` sobre `code` es exhaustivo:

```typescript twoslash
import { createNetworkFault, ERR_ABORTED, type Fault } from '@defjs/core'

function triage(fault: Fault): string {
  switch (fault.code) {
    case 'HTTP_STATUS':
      return `status ${fault.status}`
    case 'RES_MEDIA_TYPE_INVALID':
    case 'RES_DECODE_FAILED':
    case 'RES_STRUCT_MISMATCH':
      return 'the contract did not hold'
    case 'NET_TIMEOUT':
    case 'NET_ABORTED':
    case 'NET_UNREACHABLE':
    case 'NET_BODY_INCOMPLETE':
      return 'retryable'
    case 'REQ_INPUT_INVALID':
    case 'REQ_OPTIONS_INVALID':
    case 'REQ_BUILD_FAILED':
      return 'fix the call'
    case 'EXT_INTERCEPTOR_FAILED':
    case 'EXT_HOOK_FAILED':
    case 'EXT_OBSERVER_FAILED':
      return 'fix the code you attached'
    case 'CAP_BUFFER_EXCEEDED':
    case 'CAP_QUEUE_OVERFLOW':
      return 'raise a declared limit or read faster'
    case 'ENV_UNSUPPORTED':
      return 'the host runtime is missing something'
  }
}

const example: Fault = createNetworkFault(ERR_ABORTED)
console.log(triage(example))
```

## Códigos estables

| Clase  | Códigos                                                                | Quién tiene que cambiar                                 |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `HTTP` | `HTTP_STATUS`                                                          | El par respondió no-2xx; trátalo como lógica de negocio |
| `REQ`  | `REQ_INPUT_INVALID`, `REQ_OPTIONS_INVALID`, `REQ_BUILD_FAILED`         | La llamada o la declaración del endpoint                |
| `NET`  | `NET_ABORTED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `NET_BODY_INCOMPLETE` | Nadie, o reintentar                                     |
| `RES`  | `RES_MEDIA_TYPE_INVALID`, `RES_DECODE_FAILED`, `RES_STRUCT_MISMATCH`   | Hay que reconciliar la declaración y el par             |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`     | El código que enganchaste a la tubería                  |
| `CAP`  | `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`                            | Un límite declarado, o el ritmo del consumidor          |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | El runtime anfitrión                                    |

El conjunto es cerrado a propósito: eso es lo que mantiene exhaustivo un `switch`. Las extensiones reportan su propio detalle por `cause`, no con un código nuevo.

### Campos por forma

| Código        | `status` | `response`                                                    | `data`                                     |
| ------------- | -------- | ------------------------------------------------------------- | ------------------------------------------ |
| `HTTP_STATUS` | Siempre  | Siempre; tiene `body` solo si `error` se declaró y decodificó | Cuerpo `error` decodificado, o `undefined` |
| `RES_*`       | Siempre  | Siempre, solo metadatos — **sin `body`**                      | Ausente                                    |
| Todo lo demás | Ausente  | Solo donde el transporte ya tenía metadatos                   | Ausente                                    |

`cause` lleva el valor subyacente: un `StructError` para un desajuste de struct, el fallo del parser para una representación ilegible, lo que sea que lanzó una extensión.

## Formas de tupla por transporte

```typescript twoslash
import type {
  DecodedResponse,
  EventStreamHandle,
  EventStreamOpenInfo,
  Fault,
  HttpMeta,
  WebSocketConnectionInfo,
  WebSocketSession,
} from '@defjs/core'

type HttpResult =
  | [err: null, data: unknown, response: DecodedResponse<unknown> | HttpMeta]
  | [err: Fault, data: undefined, response: undefined]
type SseResult =
  | [err: null, stream: EventStreamHandle<unknown>, open: EventStreamOpenInfo]
  | [err: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]
type SocketResult =
  | [err: null, session: WebSocketSession<unknown>, connection: WebSocketConnectionInfo]
  | [err: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const results: [HttpResult, SseResult, SocketResult] | undefined = undefined
void results
```

En un fallo HTTP el tercer hueco es `undefined`: el fault ya lleva los metadatos de respuesta que existieran. Eso importa porque el fault es lo que pasas a un handler, logueas o vuelves a lanzar, así que los metadatos tienen que viajar _con_ él y no a su lado.

Para SSE y WebSocket el tercer hueco es una instantánea del arranque, que puede estar presente incluso cuando el arranque falló. Después de que un handle o una sesión vuelva, los fallos posteriores viven en su ciclo de vida: nunca reescriben la tupla de arranque ya resuelta.

## Cómo se lee un cuerpo

`ok` es la única bifurcación, y solo un lado decodifica. `output` lee un cuerpo 2xx; `error` lee todo lo demás. Omitir uno significa que ese cuerpo nunca se lee.

| Situación                                             | Resultado                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| 2xx, `output` declarado, el cuerpo decodifica         | Éxito; `data` y `response.body` tipados                       |
| 2xx, `output` omitido                                 | Éxito; `data` es `undefined`, la respuesta no tiene `body`    |
| No-2xx, `error` declarado, el cuerpo decodifica       | `HTTP_STATUS` con `data` tipado                               |
| No-2xx, `error` omitido                               | `HTTP_STATUS` con `data: undefined`                           |
| El media type no es el que la representación necesita | `RES_MEDIA_TYPE_INVALID`, avisado **antes** de leer el cuerpo |
| Los bytes no son esa representación                   | `RES_DECODE_FAILED`                                           |
| El valor no es ese struct                             | `RES_STRUCT_MISMATCH`                                         |
| Un cuerpo ilegible en el lado que **no** declaraste   | Ignorado por completo — mira abajo                            |

Esa última fila es la que vale la pena recordar. Si declaraste `output` pero no `error`, un 500 cuyo cuerpo es JSON malformado se reporta como `HTTP_STATUS` con `status: 500`. Dijiste que no te importaban los cuerpos de error, y eso incluye no importarte que uno no se pudiera leer.

La decodificación ocurre una sola vez, después de la cadena de interceptores. Una respuesta que un interceptor construyó con `makeResponse(...)` pasa por la misma comprobación de media type y el mismo struct que una del cable.

`HttpResponse.ok` solo significa `200 <= status < 300`. Un fallo de transporte es un fault, nunca una respuesta: no hay ninguna respuesta con estado 0 que haga sus veces.

## Estrechar una unión de cuerpos de error

Un único struct `error` cubre todos los estados no-2xx, así que cuando las formas difieren declaras una unión. Lo que puedas hacer después con `fault.data` depende por completo de cómo declaraste esa unión: la librería te devuelve exactamente el tipo que pediste.

`struct.or(...)` produce una unión llana, que TypeScript no puede estrechar por sí solo. Comprueba el campo que necesitas:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` estrecha por un campo que el cuerpo realmente lleva, la forma cómoda cuando la API ya etiqueta sus errores:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('validation'), fields: struct.array(struct.string()) }),
  struct.object({ kind: struct.literal('rateLimit'), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS') {
  switch (fault.data.kind) {
    case 'validation':
      console.log(fault.data.fields.length)
      break
    case 'rateLimit':
      console.log(fault.data.retryAfter)
      break
  }
}
```

Cuando la API pone el estado **dentro** del cuerpo, discrimina por eso en lugar de por `fault.status`:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('status', [
  struct.object({ status: struct.literal(404), resource: struct.string() }),
  struct.object({ status: struct.literal(429), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && fault.data.status === 429) {
  console.log(fault.data.retryAfter)
}
```

Esa última forma es preferible donde la API la soporte. `fault.status` es el número de la capa HTTP, que un proxy, un gateway o un CDN pueden reescribir; `data.status` se decodificó del cuerpo que tu struct `error` afirmó, así que llegar a él es prueba de que el backend lo produjo.

Una unión no discriminada que no se estrecha es una propiedad de la declaración, no de la librería: te entrega el tipo que declaraste. Añade un discriminante al struct si quieres uno.

## Arranque frente a después de abrir

SSE valida el estado, `text/event-stream` y la presencia de un cuerpo antes de resolver el handle. No-2xx → `HTTP_STATUS`. Media type incorrecto → `RES_MEDIA_TYPE_INVALID`. Cuerpo ausente → `RES_DECODE_FAILED`. La instantánea de apertura aún puede caer en el tercer hueco de la tupla.

El arranque de WebSocket cubre el handshake más la primera apertura física. Un fallo del constructor, un cierre antes de abrir, un timeout o una cancelación producen todos una tupla de arranque. Puede existir una instantánea de conexión incluso si el socket nunca llegó a `open`.

| Transporte | Después del arranque                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSE        | El iterador rechaza ante un error fatal; `stream.closed` resuelve con `kind: 'error'` y el `code` del fault                                                  |
| WebSocket  | `onRuntimeError` para fallos de mensaje/cola/heartbeat; `receive` falla ante errores terminales; `session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP       | La promesa de execute se resuelve una vez. El código de interceptores y callbacks todavía puede lanzar fuera de la normalización de la tupla                 |

`NET_ABORTED` / `NET_TIMEOUT` describen lo que vio quien llamó durante el arranque. Aun así cierras un stream o una sesión devueltos y esperas su promesa terminal.

## Logging de Error nativo y cause

Los faults son instancias de `Error` nativo, así que no hace falta ningún adaptador de diagnóstico. `String(fault)` da la forma nativa estable `DefjsFault: <message>`. `code` y los campos de cada variante — `status`, `response`, `data` — siguen siendo enumerables para logging estructurado; `name` y la cadena nativa `cause` no son enumerables.

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

Estrecha `fault.cause instanceof StructError` antes de llamar a `format()`, `flatten()` o `prettify()`. Esos helpers viven en la cause del Struct; no se copian al fault. No hagas que el flujo de control parsee `message` ni `String(fault)`: el contrato es `code` y un `status` revisado.

## Referencia

| Rama                       | Comprobación de flujo              | Campos estables útiles                   | Normalmente ausente / sensible               |
| -------------------------- | ---------------------------------- | ---------------------------------------- | -------------------------------------------- |
| Política de estado HTTP    | `fault.code === 'HTTP_STATUS'`     | `fault.status`, `fault.data` revisado    | Cuerpo, headers, URL, `cause`                |
| Cancelación de quien llama | `fault.code === 'NET_ABORTED'`     | `code`                                   | Motivo de cancelación y stack                |
| Timeout                    | `fault.code === 'NET_TIMEOUT'`     | `code`                                   | URL de la petición y cause subyacente        |
| El contrato se rompió      | `fault.code.startsWith('RES_')`    | `code`, `fault.response.status` revisado | Issues de Struct, cuerpo, valores de entrada |
| Tu propio código lanzó     | `fault.code.startsWith('EXT_')`    | `code`, `cause`                          | Lo que la extensión adjuntara                |
| Runtime de stream/sesión   | `stream.closed` / `session.closed` | `kind` y `code` terminales               | Payloads de eventos, frames, causes          |

Trata `cause`, `data`, los headers y cuerpos de respuesta, las URLs, los issues de Struct, los valores de entrada y los stacks como sensibles. Un resumen conservador:

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`, `createPreflightFault`, `createDecodeFault`, `createHttpStatusFault` y `createUndecodedHttpStatusFault` construyen estos valores de Error nativo. Los fallos normales de petición siguen devolviéndose en la tupla; no se lanzan solo por heredar el comportamiento de Error nativo. `ERR_ABORTED` y `ERR_TIMEOUT` son las causes compartidas que reconoce el normalizador de transporte.

## Recetas relacionadas

- [GET con un 404 declarado](../recipes/get-declared-404.md)
- [Cancelar una llamada HTTP](../recipes/cancel-http.md)
