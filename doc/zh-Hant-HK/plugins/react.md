---
title: React
description: Install provider，讀 client，fetch 一個 user，effect 再 run 時 abort。
---

# React

將現有 `@defjs/core` client wire 入 React tree。你拎到 Context 同 `useClient()`。Package **唔會** create client、加 cache、retry commands，或者 dispose transport resources。開始工作嘅 component、effect 或者 data library own 住佢。

## Basic Setup

Install `@defjs/core`、`@defjs/react` 同 React 18+。ESM；喺 Node run 時要 Node.js 22+：

`bun add @defjs/core @defjs/react react`

Provide client，之後 fetch user，change 時 abort：

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

`ClientProvider` 係普通 Context provider。唔同 `client` prop 會改 descendants 見到嘅嘢 — 冇 clone、replace 或者 dispose。Nested providers 建立明確 boundaries。

React 喺 development 可能 setup 同 clean up effect 多過一次。Signal check 阻止 stale promise 寫入而家嘅 render。Tuple error 仍然係 data。

## 用 `useClient` 讀

`useClient()` return 最近嘅 `Client`。喺 render 期間 call（component 或者 custom hook）。冇 provider 就 throw：

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

Hook 淨係供應 client。佢唔會開始工作、subscribe transport，或者將 error-first tuple 變做 exception。

## Own query work

Query library 可以 own caching、retries、stale-result suppression 同 cancellation。將佢提供嘅 signal 傳過去。List pages 用 TanStack Query（或者類似嘅）包住 `client.execute(...)`——`@defjs/react` 只做 DI，**唔會** ship `useRequest`。

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

唔好將同一個 command wrap 入第二個 effect — 兩個 owners 會令 cancel 同 stale-result handling 變模糊。

## Own realtime work

SSE 同 WebSocket handles 會 outlive `client.execute(...)`。Await startup 之前先 register cleanup，dispose 之後先到嘅 handle 要 close，consume 佢唯一個 iterator，await terminal promise：

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

`EventStreamHandle` 同一條規則：喺 `finally` close，await `stream.closed`。WebSocket consumers 亦要 unsubscribe state/runtime-error listeners，同保持讀 `session.receive` — unread bounded queue 可以 overflow。

## SSR 同 client scope

Package entry 係 Client Component boundary。Browser app 可以 share module-scoped client，當 endpoint、interceptors 同 captured state 係 browser-safe 同 request-independent。SSR 時，當 headers、cookies、users、tenants 或者 credentials 唔同時，喺每個 request boundary 入面 create 分開嘅 client。

Provider unmount **唔會** abort HTTP、close SSE/WebSocket、unsubscribe listeners，或者 call `dispose`。`@defjs/react` 冇呢類 lifecycle API。開始每次 operation 嘅 code 一定要 finish 或者 cancel 佢。

## Reference

`@defjs/react` 嘅 public exports：

- `ClientProvider` — 接受 `ClientProviderProps`，provide 傳入嘅 client
- `useClient` — 最近嘅 client，或者 throw
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

Clients 同 options 喺 `@defjs/core` create。睇 [Client](../core/client.md)、[Errors](../core/errors.md)、[SSE](../core/sse.md) 同 [WebSocket](../core/web-socket.md)。

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
- [Consume an SSE stream](../recipes/consume-sse.md)
- [Open a WebSocket session](../recipes/websocket-session.md)
