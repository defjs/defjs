---
title: React
description: Install the provider, read the client, fetch a user, and abort when the effect re-runs.
---

# React

Wire an existing `@defjs/core` client into a React tree. You get Context and `useClient()`. The package does **not** create a client, add a cache, retry commands, or dispose transport resources. The component, effect, or data library that starts work owns it.

## Basic Setup

Install `@defjs/core`, `@defjs/react`, and React 18+. ESM; Node.js 22+ when running in Node:

`bun add @defjs/core @defjs/react react`

Provide the client, then fetch a user and abort on change:

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

`ClientProvider` is a normal Context provider. A different `client` prop changes what descendants see — no clone, replace, or dispose. Nested providers create explicit boundaries.

React may set up and clean up an effect more than once in development. The signal check stops a stale promise from writing into the current render. The tuple error is still data.

## Read with `useClient`

`useClient()` returns the nearest `Client`. Call it during render (component or custom hook). Throws when no provider exists:

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

The hook only supplies the client. It doesn’t start work, subscribe to a transport, or turn the error-first tuple into an exception.

## Own query work

A query library can own caching, retries, stale-result suppression, and cancellation. Give it the signal it provides. For list pages, wrap `client.execute(...)` with TanStack Query (or similar) — `@defjs/react` stays DI only and does **not** ship `useRequest`.

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

Don’t wrap the same command in a second effect — two owners make cancel and stale-result handling ambiguous.

## Own realtime work

SSE and WebSocket handles outlive `client.execute(...)`. Register cleanup before awaiting startup, close a handle that arrives after disposal, consume its single iterator, await its terminal promise:

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

Same rule for `EventStreamHandle`: close in `finally`, await `stream.closed`. WebSocket consumers must also unsubscribe state/runtime-error listeners and keep reading `session.receive` — an unread bounded queue can overflow.

## SSR and client scope

The package entry is a Client Component boundary. A browser app can share a module-scoped client when endpoint, interceptors, and captured state are browser-safe and request-independent. For SSR, create a separate client inside each request boundary when headers, cookies, users, tenants, or credentials differ.

Provider unmount does **not** abort HTTP, close SSE/WebSocket, unsubscribe listeners, or call `dispose`. `@defjs/react` has no such lifecycle API. The code that starts each operation must finish or cancel it.

## Reference

Public exports from `@defjs/react`:

- `ClientProvider` — accepts `ClientProviderProps`, provides the supplied client
- `useClient` — nearest client, or throws
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

Create clients and options in `@defjs/core`. See [Client](../core/client.md), [Errors](../core/errors.md), [SSE](../core/sse.md), and [WebSocket](../core/web-socket.md).

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
- [Consume an SSE stream](../recipes/consume-sse.md)
- [Open a WebSocket session](../recipes/websocket-session.md)
