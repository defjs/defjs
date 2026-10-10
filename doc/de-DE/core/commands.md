---
title: Commands
description: Endpoints definieren, opake Commands bauen, Inputs mappen und Transport-Ergebnisse inferieren.
---

# Commands

Eine Definition → Endpoint → opaker Command → `client.execute`. Dieselbe Pipeline für HTTP, SSE und WebSocket.

## Basic Setup

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## Definition wählen

| Definition               | Vertrag                                                                 | Erfolgreicher Wert                       |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------- |
| `defineRequest(...)`     | Method, relativer Path, optionaler Input, optionales `output` / `error` | Dekodierte Daten + Response              |
| `defineEventStream(...)` | Path, Buffer-/Queue-Limits, Event-Name → Struct-Map                     | `EventStreamHandle` + Open-Snapshot      |
| `defineWebSocket(...)`   | Path, ein Incoming-Struct, optionaler Outgoing-Struct, Queue-Limit      | `WebSocketSession` + Connection-Snapshot |

Kein `input` → der Endpoint nimmt kein Argument, und `builder` darf `() => request` sein. Mit `input` → den Struct-Wert übergeben. Ein optionales Field darf fehlen; ein required Field nicht.

Halte Commands opak. Grab nicht in Tags oder Symbole.

## Wohin Werte gehen

Der Struct entscheidet, wie ein Wert encodet wird. Der `builder` entscheidet, wohin er geht. `builder` ist eine synchrone pure Function des **geparsten** Inputs. Er läuft zur Execute-Zeit. Ein Throw wird `REQ_BUILD_FAILED` auf dem Tupel — der Endpoint-Aufruf selbst throwt nicht.

Ein deklarierter `input` erfordert immer einen expliziten `builder`, auch wenn der Input bereits die Request-Shape hat. Nur Definitionen ohne `input` dürfen `builder` weglassen.

Reich den typisierten Wert durch. Alias, `Date` → ISO und `bigint` → String gelten dann überall, wo dieser Struct genutzt wird: Request-Platzierung, Response-Decoding, SSE-Events und WebSocket-Frames.

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

Der Body ist JSON `{"display_name":"…","email":"…"}`. Ein selbst geschriebener Key ist die Escape-Luke: `body: { name: input.user.displayName }` sendet `name`, weil das Parent-Object anonym ist und der Alias nicht gilt.

## Wenn die Shapes auseinanderlaufen

Nutze `builder` für Path-Placeholder, Literale und Branches. Er bekommt den echten Wert, also funktionieren `if`, `??`, Templates und `switch`.

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

`query: input.query` sendet `page_size`. `headers: { 'x-api-version': '2' }` ist ein Literal. Auth und Tracing gehören weiter in Interceptors: sie sehen den nativen Request, nachdem der Builder gelaufen ist.

## Output- und Error-Shapes

`output` ist ein Struct für den 2xx-Body; `error` ist ein Struct für alles andere. `ok` ist die einzige
Verzweigung, und es dekodiert immer nur eine Seite. Eine Seite auszulassen heißt, dass dieser Body
nie gelesen wird: der Fault trägt den Status, und `data` bleibt `undefined`.

## Verwandte Rezepte

- [GET mit deklariertem 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
