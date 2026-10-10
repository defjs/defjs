---
title: React
description: provider를 설치하고, 클라이언트를 읽고, 사용자를 fetch하며, effect가 다시 돌 때 abort 해요.
---

# React

기존 `@defjs/core` 클라이언트를 React 트리에 연결해요. Context와 `useClient()`를 받아요. 패키지는 클라이언트를 **만들지 않고**, 캐시를 더하지 않으며, 명령을 재시도하지 않고, 전송 리소스를 dispose하지도 않아요. 작업을 시작한 컴포넌트, effect, 또는 데이터 라이브러리가 소유해요.

## Basic Setup

`@defjs/core`, `@defjs/react`, React 18+를 설치하세요. ESM이고, Node에서 돌릴 때는 Node.js 22+예요.

`bun add @defjs/core @defjs/react react`

클라이언트를 제공한 뒤, 사용자를 fetch하고 변경 시 abort 해요.

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

`ClientProvider`는 일반 Context provider예요. 다른 `client` prop은 자손이 보는 값을 바꿔요 — 복제, 교체, dispose는 없어요. 중첩 provider는 명시적 경계를 만들어요.

개발 모드에서 React는 effect를 두 번 이상 설정·정리할 수 있어요. signal 검사는 낡은 프로미스가 현재 렌더에 쓰지 못하게 해요. 튜플 오류는 여전히 data예요.

## `useClient`로 읽기

`useClient()`는 가장 가까운 `Client`를 돌려줘요. 렌더 중(컴포넌트 또는 커스텀 훅)에 호출하세요. provider가 없으면 throw해요.

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

훅은 클라이언트만 공급해요. 작업을 시작하거나, 전송을 구독하거나, error-first 튜플을 예외로 바꾸지 않아요.

## 쿼리 작업 소유하기

쿼리 라이브러리가 캐싱, 재시도, 낡은 결과 억제, 취소를 소유할 수 있어요. 라이브러리가 주는 signal을 넘기세요. 목록 페이지에서는 `client.execute(...)`를 TanStack Query(또는 비슷한 것)로 감싸세요. `@defjs/react`는 DI만 하고 `useRequest`를 제공하지 **않아요**.

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

같은 명령을 두 번째 effect로 감싸지 마세요 — 소유자가 둘이면 취소와 낡은 결과 처리가 모호해져요.

## 실시간 작업 소유하기

SSE와 WebSocket 핸들은 `client.execute(...)`보다 오래 살아요. 시작을 await하기 전에 정리를 등록하고, dispose 뒤에 도착한 핸들을 닫고, 단일 iterator를 소비하고, 종료 프로미스를 await 하세요.

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

`EventStreamHandle`도 같은 규칙이에요. `finally`에서 닫고 `stream.closed`를 await 하세요. WebSocket 소비자는 상태/런타임 오류 리스너도 구독 해제하고 `session.receive`를 계속 읽어야 해요 — 읽지 않은 한정 큐는 오버플로할 수 있어요.

## SSR과 클라이언트 범위

패키지 진입점은 Client Component 경계예요. 브라우저 앱은 엔드포인트, 인터셉터, 담은 상태가 브라우저에 안전하고 요청에 독립적일 때 모듈 범위 클라이언트를 공유할 수 있어요. SSR에서는 헤더, 쿠키, 사용자, 테넌트, 자격 증명이 다르면 요청 경계마다 별도 클라이언트를 만들어요.

provider unmount는 HTTP를 abort하거나, SSE/WebSocket을 닫거나, 리스너를 구독 해제하거나, `dispose`를 호출하지 **않아요**. `@defjs/react`에는 그런 수명 API가 없어요. 각 작업을 시작한 코드가 끝내거나 취소해야 해요.

## Reference

`@defjs/react`의 공개 export:

- `ClientProvider` — `ClientProviderProps`를 받고 넘긴 클라이언트를 제공
- `useClient` — 가장 가까운 클라이언트, 없으면 throw
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

클라이언트와 옵션은 `@defjs/core`에서 만들어요. [클라이언트](../core/client.md), [오류](../core/errors.md), [SSE](../core/sse.md), [WebSocket](../core/web-socket.md)을 보세요.

## 관련 레시피

- [선언된 404가 있는 GET](../recipes/get-declared-404.md)
- [HTTP 호출 취소하기](../recipes/cancel-http.md)
- [SSE 스트림 소비하기](../recipes/consume-sse.md)
- [WebSocket 세션 열기](../recipes/websocket-session.md)
