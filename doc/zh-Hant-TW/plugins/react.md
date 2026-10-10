---
title: React
description: 安裝 provider、讀取 client、抓使用者，並在 effect 重跑時 abort。
---

# React

把既有的 `@defjs/core` client 接進 React tree。你拿到 Context 與 `useClient()`。這個套件**不會**建立 client、加快取、重試 commands，或 dispose 傳輸資源。啟動工作的元件、effect 或 data library 才是擁有者。

## Basic Setup

安裝 `@defjs/core`、`@defjs/react`，以及 React 18+。ESM；在 Node 跑時需要 Node.js 22+：

`bun add @defjs/core @defjs/react react`

提供 client，然後抓使用者並在變更時 abort：

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
  builder: (input) => ({ path: input.path }),
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

`ClientProvider` 是一般的 Context provider。換掉 `client` prop 會改變後代看到的東西 — 不會 clone、replace 或 dispose。巢狀 providers 建立明確邊界。

開發模式下 React 可能多次 setup／clean up effect。Signal 檢查可避免過期 promise 寫進目前的 render。Tuple 錯誤仍是資料。

## 用 `useClient` 讀取

`useClient()` 回傳最近的 `Client`。在 render 期間呼叫（元件或自訂 hook）。沒有 provider 時會 throw：

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

Hook 只提供 client。它不會啟動工作、訂閱傳輸，或把 error-first tuple 變成 exception。

## 自己擁有 query 工作

Query library 可以擁有快取、重試、壓制過期結果、取消。把庫提供的 signal 傳進去。列表頁請把 `client.execute(...)` 包進 TanStack Query（或類似方案）——`@defjs/react` 只做 DI，**不會**附帶 `useRequest`。

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
  builder: (input) => ({ path: input.path }),
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

別把同一個 command 再包一層 effect — 兩個擁有者會讓取消與過期結果處理變模糊。

## 自己擁有 realtime 工作

SSE 與 WebSocket handles 比 `client.execute(...)` 活得更久。在 await 啟動前先註冊 cleanup；若 dispose 後才拿到 handle 就關閉它；消費它的單一 iterator；await 終端 promise：

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

`EventStreamHandle` 同規則：在 `finally` close，await `stream.closed`。WebSocket 消費者還要 unsubscribe state／runtime-error listeners，並持續讀 `session.receive` — 未讀的有界 queue 可能 overflow。

## SSR 與 client 範圍

套件進入點是 Client Component 邊界。瀏覽器應用在 endpoint、interceptors、捕捉狀態都對瀏覽器安全且與請求無關時，可以共用 module-scoped client。SSR 時，若 headers、cookies、users、tenants 或 credentials 不同，請在每個請求邊界內建立分開的 client。

Provider unmount **不會** abort HTTP、關閉 SSE／WebSocket、unsubscribe listeners，或呼叫 `dispose`。`@defjs/react` 沒有這種生命週期 API。啟動每次操作的程式碼必須把它做完或取消。

## Reference

`@defjs/react` 的公開 exports：

- `ClientProvider` — 接受 `ClientProviderProps`，提供傳入的 client
- `useClient` — 最近的 client，或 throw
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

在 `@defjs/core` 建立 clients 與 options。見 [Client](../core/client.md)、[錯誤](../core/errors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md)。

## 相關 recipes

- [已宣告 404 的 GET](../recipes/get-declared-404.md)
- [取消 HTTP 呼叫](../recipes/cancel-http.md)
- [消費 SSE 串流](../recipes/consume-sse.md)
- [開啟 WebSocket session](../recipes/websocket-session.md)
