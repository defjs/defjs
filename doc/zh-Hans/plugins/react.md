---
title: React
description: 装 provider、读 Client、拉用户，并在 effect 重跑时 abort。
---

# React

把已有的 `@defjs/core` Client 接到 React 树。你拿到 Context 和 `useClient()`。这个包**不会**创建 Client、加缓存、重试 command，也不会释放传输资源。启动工作的组件、effect 或数据库拥有它。

## 基本用法

装 `@defjs/core`、`@defjs/react`，以及 React 18+。ESM；在 Node 里跑要 Node.js 22+：

`bun add @defjs/core @defjs/react react`

Provide Client，再按变化 abort 拉用户：

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

`ClientProvider` 是普通 Context provider。换 `client` prop 就换后代看到的——不 clone、不替换、不释放。嵌套 provider 形成显式边界。

开发模式下 React 可能多次 setup/cleanup effect。Signal 检查拦住过期 promise 写进当前渲染。Tuple 错误仍是数据。

## 用 `useClient` 读

`useClient()` 返回最近的 `Client`。在 render 期间调用（组件或自定义 hook）。没有 provider 就抛：

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

Hook 只提供 Client。它不启动工作、不订阅传输，也不把错误优先 tuple 变成异常。

## 自己管 query 工作

Query 库可以拥有缓存、重试、过期结果抑制、取消。把库给你的 signal 传进去：

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

别把同一 command 再包一层 effect——两个所有者会让取消和过期结果处理含糊。

## 自己管 realtime 工作

SSE 和 WebSocket handle 比 `client.execute(...)` 活得久。await 启动前先注册清理，关晚到释放之后才到的 handle，消费唯一 iterator，await 终止 promise：

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

`EventStreamHandle` 同理：在 `finally` 里 close，await `stream.closed`。WebSocket 消费者还要退订状态/运行时错误监听，并持续读 `session.receive`——有界队列不读会溢出。

## SSR 与 Client 作用域

包入口是 Client Component 边界。浏览器应用在 endpoint、interceptor、抓住的状态对浏览器安全且请求无关时，可以共享模块作用域 Client。SSR 时若 headers、cookie、用户、租户、凭证不同，在每个请求边界里单独创建 Client。

Provider 卸载**不会** abort HTTP、关 SSE/WebSocket、退订监听，也不会调 `dispose`。`@defjs/react` 没有这套生命周期 API。启动每次操作的代码必须收尾或取消。

## 参考

`@defjs/react` 的公开导出：

- `ClientProvider` — 收 `ClientProviderProps`，provide 传入的 Client
- `useClient` — 最近的 Client，没有就抛
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

Client 和 options 在 `@defjs/core` 里创建。见 [Client](../core/client.md)、[Errors](../core/errors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md)。

## 相关配方

- [声明了 404 的 GET](../recipes/get-declared-404.md)
- [取消一次 HTTP](../recipes/cancel-http.md)
- [消费 SSE 流](../recipes/consume-sse.md)
- [打开 WebSocket 会话](../recipes/websocket-session.md)
