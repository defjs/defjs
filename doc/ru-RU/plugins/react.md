---
title: React
description: Поставь provider, прочитай клиент, запроси пользователя и abort, когда effect перезапускается.
---

# React

Подключи существующий `@defjs/core` client к React-дереву. Получаешь Context и `useClient()`. Пакет **не** создаёт client, не вешает кеш, не ретраит команды и не dispose’ит ресурсы транспорта. Компонент, effect или data-библиотека, которые стартуют работу, ей владеют.

## Базовая настройка

Поставь `@defjs/core`, `@defjs/react` и React 18+. ESM; Node.js 22+, если гоняешь в Node:

`bun add @defjs/core @defjs/react react`

Отдай клиент, потом запроси пользователя и abort при смене:

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

`ClientProvider` — обычный Context provider. Другой prop `client` меняет то, что видят потомки — без clone, replace или dispose. Вложенные провайдеры создают явные границы.

React в development может поставить и снять effect больше одного раза. Проверка signal не даёт устаревшему promise писать в текущий рендер. Ошибка кортежа всё ещё данные.

## Читай через `useClient`

`useClient()` возвращает ближайший `Client`. Зови во время рендера (компонент или свой хук). Бросает, если провайдера нет:

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

Хук только отдаёт клиент. Работу он не стартует, на транспорт не подписывается и error-first кортеж в исключение не превращает.

## Владей query-работой

Query-библиотека может владеть кешем, ретраями, подавлением устаревшего результата и отменой. Отдай ей signal, который она даёт. Для страниц-списков оберни `client.execute(...)` в TanStack Query (или похожее) — `@defjs/react` остаётся только DI и `useRequest` **не** везёт.

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

Не оборачивай ту же команду во второй effect — два владельца делают отмену и обработку устаревшего результата неоднозначными.

## Владей realtime-работой

Handle SSE и WebSocket живут дольше `client.execute(...)`. Зарегистрируй cleanup до ожидания старта, закрой handle, который приехал после disposal, потреби единственный iterator, дождись терминального promise:

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

То же правило для `EventStreamHandle`: close в `finally`, await `stream.closed`. Потребители WebSocket ещё должны отписать listener’ы state и runtime-error и продолжать читать `session.receive` — непрочитанная ограниченная очередь может переполниться.

## SSR и scope клиента

Точка входа пакета — граница Client Component. Браузерное приложение может делить клиент на уровне модуля, когда эндпоинт, interceptors и захваченное состояние безопасны для браузера и не зависят от запроса. Для SSR создавай отдельный клиент внутри каждой границы запроса, когда различаются заголовки, cookies, пользователи, tenants или credentials.

Unmount провайдера **не** abort’ит HTTP, не закрывает SSE/WebSocket, не отписывает listener’ы и не зовёт `dispose`. У `@defjs/react` такого lifecycle API нет. Код, который стартовал каждую операцию, должен её закончить или отменить.

## Справка

Публичные экспорты `@defjs/react`:

- `ClientProvider` — принимает `ClientProviderProps`, отдаёт переданный клиент
- `useClient` — ближайший клиент, или бросает
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

Клиентов и опции создавай в `@defjs/core`. См. [Клиент](../core/client.md), [Ошибки](../core/errors.md), [SSE](../core/sse.md) и [WebSocket](../core/web-socket.md).

## Связанные рецепты

- [GET с объявленным 404](../recipes/get-declared-404.md)
- [Отменить HTTP-вызов](../recipes/cancel-http.md)
- [Читать SSE-стрим](../recipes/consume-sse.md)
- [Открыть WebSocket-сессию](../recipes/websocket-session.md)
