---
title: Comandos
description: Define endpoints, construye comandos opacos, mapea entradas e infiere resultados de transporte.
---

# Comandos

Una definición → endpoint → comando opaco → `client.execute`. El mismo pipeline para HTTP, SSE y WebSocket.

## Basic Setup

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## Elige una definición

| Definición               | Contrato                                                             | Valor en éxito                            |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------- |
| `defineRequest(...)`     | Método, path relativo, input opcional, `output` / `error` opcionales | Datos decodificados + respuesta           |
| `defineEventStream(...)` | Path, límites de buffer/cola, mapa nombre de evento → Struct         | `EventStreamHandle` + snapshot de open    |
| `defineWebSocket(...)`   | Path, un struct incoming, struct outgoing opcional, límite de cola   | `WebSocketSession` + snapshot de conexión |

Sin `input` → el endpoint no toma argumento, y `builder` puede ser `() => request`. Con `input` → pasa el valor del struct. Un campo opcional puede omitirse; uno requerido no.

Mantén los comandos opacos. No husmees tags ni símbolos.

## Dónde van los valores

El struct decide cómo se codifica un valor. El `builder` decide dónde va. `builder` es una función pura y síncrona del input **ya parseado**. Corre en el momento de execute. Un throw se convierte en `REQ_BUILD_FAILED` en la tupla: la llamada al endpoint en sí no lanza.

Declarar `input` siempre exige un `builder` explícito, aunque la entrada ya tenga la forma de la solicitud. Solo las definiciones sin `input` pueden omitir `builder`.

Pasa el valor tipado. El alias, `Date` → ISO y `bigint` → string se aplican entonces en todos los sitios donde se usa ese struct: colocación de la solicitud, decodificación de la respuesta, eventos SSE y frames WebSocket.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
  email: struct.string(),
})

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({ user: User }),
  builder: (input) => ({ body: input.user }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})
void createUser
```

El body es JSON `{"display_name":"…","email":"…"}`. Una clave escrita a mano es la vía de escape: `body: { name: input.user.displayName }` envía `name`, porque el objeto padre es anónimo y el alias no aplica.

## Cuando las formas difieren

Usa `builder` para placeholders de path, literales y ramas. Recibe el valor real, así que `if`, `??`, templates y `switch` funcionan.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const search = defineRequest({
  method: 'GET',
  path: '/orgs/:org_id/users',
  input: struct.object({
    orgId: struct.number(),
    query: struct.object({
      keyword: struct.string(),
      pageSize: struct.number().alias('page_size'),
    }),
  }),
  builder: (input) => ({
    path: { org_id: input.orgId },
    query: input.query,
    headers: { 'x-api-version': '2' },
  }),
  output: struct.object({ items: struct.array(struct.string()) }),
})
void search
```

`query: input.query` envía `page_size`. `headers: { 'x-api-version': '2' }` es un literal. Auth y tracing siguen perteneciendo a los interceptores: ven la solicitud nativa después de que corre el builder.

## Formas de output y error

`output` es un Struct para el cuerpo 2xx; `error` es un Struct para todo lo demás. `ok` es la única
bifurcación, y solo un lado decodifica. Omitir un lado significa que ese cuerpo nunca se lee: el fault
lleva el estado y `data` se queda en `undefined`.

## Recetas relacionadas

- [GET con un 404 declarado](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
