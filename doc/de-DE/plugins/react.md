---
title: React
description: Provider installieren, Client lesen, User fetchen und aborten, wenn der Effect neu läuft.
---

# React

Verdrahte einen bestehenden `@defjs/core`-Client in einen React-Tree. Du bekommst Context und `useClient()`. Das Paket erzeugt **keinen** Client, fügt keinen Cache hinzu, retried keine Commands und disposet keine Transport-Resources. Die Komponente, der Effect oder die Data-Library, die Arbeit startet, besitzt sie.

## Basic Setup

Installiere `@defjs/core`, `@defjs/react` und React 18+. ESM; Node.js 22+, wenn du in Node läufst:

`bun add @defjs/core @defjs/react react`

Provide den Client, dann fetche einen User und abort on Change:

```tsx twoslash
import { createClient, withEndpoint } from '@defjs/core'
import { ClientProvider } from '@defjs/react'
import type { ReactNode } from 'react'

const client = createClient(withEndpoint('https://api.example.com'))

export function ApiProvider({ children }: { children: ReactNode }) {
  return <ClientProvider client={client}>{children}</ClientProvider>
}
```

```tsx twoslash
import { defineRequest, struct } from '@defjs/core'
import { useClient } from '@defjs/react'
import { useEffect, useState } from 'react'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  output: struct.object({ name: struct.string() }),
})

export function UserName({ id }: { id: number }) {
  const client = useClient()
  const [name, setName] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()

    void client.execute(getUser({ path: { id } }), { signal: controller.signal }).then(([error, user]) => {
      if (controller.signal.aborted) return
      setName(error ? undefined : user.name)
    })

    return () => controller.abort()
  }, [client, id])

  return <span>{name ?? 'Loading...'}</span>
}
```

`ClientProvider` ist ein normaler Context-Provider. Ein anderer `client`-Prop ändert, was Descendants sehen — kein Clone, Replace oder Dispose. Nested Provider erzeugen explizite Boundaries.

React kann einen Effect in Development mehr als einmal setuppen und cleanupen. Der Signal-Check stoppt ein stale Promise daran, in den aktuellen Render zu schreiben. Der Tupel-Error bleibt Data.

## Mit `useClient` lesen

`useClient()` gibt den nächsten `Client` zurück. Ruf ihn während Render auf (Komponente oder Custom Hook). Throwt, wenn kein Provider existiert:

```tsx twoslash
import { defineRequest, struct } from '@defjs/core'
import { useClient } from '@defjs/react'

const health = defineRequest({
  method: 'GET',
  path: '/health',
  output: struct.object({ ok: struct.boolean() }),
})

export function HealthCheck() {
  const client = useClient()

  const check = async () => {
    const [error, result] = await client.execute(health())
    if (error) {
      console.error(error.code)
      return
    }
    console.log(result.ok)
  }

  return (
    <button type="button" onClick={() => void check()}>
      Check service
    </button>
  )
}
```

Der Hook liefert nur den Client. Er startet keine Arbeit, subscribed keinen Transport und macht aus dem Error-first-Tupel keine Exception.

## Query-Arbeit besitzen

Eine Query-Library kann Caching, Retries, Stale-Result-Suppression und Cancellation besitzen. Gib ihr das Signal, das sie liefert. Für List-Pages wrappe `client.execute(...)` mit TanStack Query (oder ähnlich) — `@defjs/react` bleibt nur DI und liefert **kein** `useRequest`.

```tsx twoslash
import { defineRequest, struct } from '@defjs/core'
import { useCallback } from 'react'
import { useClient } from '@defjs/react'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  output: struct.object({ name: struct.string() }),
})

export function useUserQueryFn(id: number) {
  const client = useClient()

  return useCallback(
    async ({ signal }: { signal: AbortSignal }) => {
      const [error, user] = await client.execute(getUser({ path: { id } }), { signal })
      if (error) throw error
      return user
    },
    [client, id],
  )
}
```

Wrappe denselben Command nicht in einen zweiten Effect — zwei Owner machen Cancel und Stale-Result-Handling ambiguous.

## Realtime-Arbeit besitzen

SSE- und WebSocket-Handles überleben `client.execute(...)`. Registriere Cleanup vor dem Await von Startup, schließe ein Handle, das nach Disposal ankommt, konsumiere seinen einzelnen Iterator, await sein Terminal-Promise:

```tsx twoslash
import { defineWebSocket, struct } from '@defjs/core'
import { useClient } from '@defjs/react'
import { useEffect } from 'react'

const notifications = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/notifications',
  incoming: struct.object({ text: struct.string() }),
})

export function Notifications() {
  const client = useClient()

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let closeActive: (() => void) | undefined

    void (async () => {
      const [error, session] = await client.execute(notifications(), { signal: controller.signal })
      if (error) return

      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        session.close(1000, 'effect-disposed')
      }
      closeActive = close

      if (disposed) {
        close()
        await session.closed
        return
      }

      try {
        for await (const message of session.receive) {
          console.info(message.text)
        }
      } finally {
        close()
        await session.closed
      }
    })()

    return () => {
      disposed = true
      controller.abort()
      closeActive?.()
    }
  }, [client])

  return null
}
```

Dieselbe Regel für `EventStreamHandle`: in `finally` schließen, `stream.closed` awaiten. WebSocket-Consumer müssen auch State-/Runtime-Error-Listener unsubscriben und `session.receive` weiterlesen — eine ungelesene bounded Queue kann overflowen.

## SSR und Client-Scope

Der Package-Entry ist eine Client-Component-Boundary. Eine Browser-App kann einen Module-scoped Client teilen, wenn Endpoint, Interceptors und captured State browser-safe und request-independent sind. Für SSR erzeuge einen separaten Client innerhalb jeder Request-Grenze, wenn Headers, Cookies, User, Tenants oder Credentials differieren.

Provider-Unmount abortet HTTP **nicht**, schließt SSE/WebSocket nicht, unsubscribed keine Listener und ruft kein `dispose`. `@defjs/react` hat keine solche Lifecycle-API. Der Code, der jede Operation startet, muss sie finishen oder canceln.

## Reference

Öffentliche Exports aus `@defjs/react`:

- `ClientProvider` — akzeptiert `ClientProviderProps`, provides den gelieferten Client
- `useClient` — nächster Client, oder throwt
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

Erzeuge Clients und Options in `@defjs/core`. Siehe [Client](../core/client.md), [Fehler](../core/errors.md), [SSE](../core/sse.md) und [WebSocket](../core/web-socket.md).

## Verwandte Rezepte

- [GET mit deklariertem 404](../recipes/get-declared-404.md)
- [HTTP-Aufruf abbrechen](../recipes/cancel-http.md)
- [SSE-Stream konsumieren](../recipes/consume-sse.md)
- [WebSocket-Session öffnen](../recipes/websocket-session.md)
