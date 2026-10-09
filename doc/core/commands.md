---
title: Commands
description: Define endpoints, build opaque commands, map inputs, and infer transport results.
---

# Commands

One definition → endpoint → opaque command → `client.execute`. Same pipeline for HTTP, SSE, and WebSocket.

## Basic Setup

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## Choose a definition

| Definition               | Contract                                                           | Successful value                         |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------- |
| `defineRequest(...)`     | Method, relative path, optional input, optional `output` / `error` | Decoded data + response                  |
| `defineEventStream(...)` | Path, buffer/queue limits, event-name → Struct map                 | `EventStreamHandle` + open snapshot      |
| `defineWebSocket(...)`   | Path, one incoming struct, optional outgoing struct, queue limit   | `WebSocketSession` + connection snapshot |

No `input` → the endpoint takes no argument, and `builder` may be `() => request`. With `input` → pass the struct value. An optional field may be omitted; a required field may not.

Keep commands opaque. Don’t dig into tags or symbols.

## Where values go

The struct decides how a value is encoded. The `builder` decides where it goes. `builder` is a synchronous pure function of the **parsed** input. It runs at execute time. A throw becomes `REQ_BUILD_FAILED` on the tuple — the endpoint call itself does not throw.

Omit `builder` when the input struct is already `{ path?, query?, headers?, body? }`. That is the identity `(input) => input`. If the parsed input is not assignable to that shape, TypeScript requires a `builder`.

Hand the typed value through. Alias, `Date` → ISO, and `bigint` → string then apply everywhere that struct is used: request placement, response decoding, SSE events, and WebSocket frames.

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

The body is JSON `{"display_name":"…","email":"…"}`. A hand-written key is the escape hatch: `body: { name: input.user.displayName }` sends `name`, because the parent object is anonymous and the alias does not apply.

## When the shapes differ

Use `builder` for path placeholders, literals, and branches. It receives the real value, so `if`, `??`, templates, and `switch` work.

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

`query: input.query` sends `page_size`. `headers: { 'x-api-version': '2' }` is a literal. Auth and tracing still belong in interceptors: they see the native request after the builder runs.

## Output and error shapes

`output` is one Struct for the 2xx body; `error` is one Struct for everything else. `ok` is the only
fork, and only one side ever decodes. Omitting a side means that body is never read: the fault
carries the status and `data` stays `undefined`.

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
