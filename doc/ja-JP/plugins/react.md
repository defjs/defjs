---
title: React
description: プロバイダを入れ、クライアントを読み、ユーザーを取得し、effect の再実行時に abort します。
---

# React

既存の `@defjs/core` クライアントを React ツリーに繋ぎます。得られるのは Context と `useClient()` です。このパッケージはクライアントを**作らず**、キャッシュも足さず、コマンドをリトライせず、トランスポートリソースも破棄しません。作業を始めたコンポーネント、effect、データライブラリが所有します。

## Basic Setup

`@defjs/core`、`@defjs/react`、React 18+ を入れます。ESM。Node で動かすときは Node.js 22+ です。

`bun add @defjs/core @defjs/react react`

クライアントを提供し、ユーザーを取得して変更時に abort します。

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

`ClientProvider` は普通の Context プロバイダです。違う `client` prop は子孫が見るものを変えます — クローンも差し替えも破棄もしません。入れ子のプロバイダは明示的な境界を作ります。

開発では React が effect を複数回セットアップ/クリーンアップすることがあります。signal チェックは、古い promise が今の描画に書き込むのを止めます。タプルのエラーはそれでもデータです。

## `useClient` で読む

`useClient()` は最も近い `Client` を返します。描画中（コンポーネントまたはカスタムフック）で呼んでください。プロバイダがなければ throw します。

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

フックはクライアントを渡すだけです。作業を始めず、トランスポートを購読せず、エラーファーストのタプルを例外にもしません。

## クエリ作業を所有する

クエリライブラリがキャッシュ、リトライ、古い結果の抑制、キャンセルを所有できます。それが渡す signal を渡します。一覧ページでは `client.execute(...)` を TanStack Query（または類似のもの）で包んでください — `@defjs/react` は DI だけのままで、`useRequest` は**出しません**。

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

同じコマンドを第二の effect で包まないでください — 所有者が二人だと、キャンセルと古い結果の扱いが曖昧になります。

## リアルタイム作業を所有する

SSE と WebSocket のハンドルは `client.execute(...)` より長生きします。起動を await する前にクリーンアップを登録し、破棄後に届いたハンドルを閉じ、その単一イテレータを消費し、終端 promise を await します。

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

`EventStreamHandle` も同じ規則です。`finally` で close し、`stream.closed` を await。WebSocket 消費者は状態/ランタイムエラーリスナーも購読解除し、`session.receive` を読み続けてください — 読まれない有界キューはオーバーフローし得ます。

## SSR とクライアントスコープ

パッケージエントリは Client Component 境界です。ブラウザーアプリは、エンドポイント・インターセプター・掴んだ状態がブラウザー安全でリクエスト非依存なら、モジュールスコープのクライアントを共有できます。SSR では、ヘッダー・cookie・ユーザー・テナント・資格情報が違うとき、リクエスト境界ごとに別のクライアントを作ります。

プロバイダの unmount は HTTP を abort せず、SSE/WebSocket を閉じず、リスナーを購読解除せず、`dispose` も呼びません。`@defjs/react` にそうしたライフサイクル API はありません。各操作を始めたコードが、終わらせるかキャンセルする必要があります。

## Reference

`@defjs/react` からの公開エクスポート:

- `ClientProvider` — `ClientProviderProps` を受け、渡されたクライアントを提供
- `useClient` — 最も近いクライアント、または throw
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

クライアントと options は `@defjs/core` で作ります。[Client](../core/client.md)、[Errors](../core/errors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md) を見てください。

## 関連レシピ

- [宣言済み 404 付きの GET](../recipes/get-declared-404.md)
- [HTTP 呼び出しをキャンセルする](../recipes/cancel-http.md)
- [SSE ストリームを消費する](../recipes/consume-sse.md)
- [WebSocket セッションを開く](../recipes/websocket-session.md)
