---
title: React
description: Installe le provider, lis le client, fetch un user, et abort quand l’effet re-run.
---

# React

Branche un client `@defjs/core` existant dans un arbre React. Tu obtiens Context et `useClient()`. Le package ne crée **pas** de client, n’ajoute pas de cache, ne relance pas les commandes et ne dispose pas les ressources de transport. Le composant, l’effet ou la lib de data qui démarre le travail le possède.

## Basic Setup

Installe `@defjs/core`, `@defjs/react` et React 18+. ESM ; Node.js 22+ quand tu tournes dans Node :

`bun add @defjs/core @defjs/react react`

Fournis le client, puis fetch un user et abort au changement :

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

`ClientProvider` est un provider Context normal. Une prop `client` différente change ce que voient les descendants — pas de clone, replace ou dispose. Les providers nested créent des frontières explicites.

React peut monter et nettoyer un effet plus d’une fois en développement. Le check du signal empêche une promesse périmée d’écrire dans le render courant. L’erreur du tuple reste de la data.

## Lire avec `useClient`

`useClient()` renvoie le `Client` le plus proche. Appelle-le pendant le render (composant ou hook custom). Throw quand aucun provider n’existe :

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

Le hook fournit seulement le client. Il ne démarre pas de travail, ne s’abonne pas à un transport, et ne transforme pas le tuple erreur en premier en exception.

## Posséder le travail de query

Une lib de query peut posséder cache, retries, suppression de résultats périmés et annulation. Donne-lui le signal qu’elle fournit :

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

Ne wrap pas la même commande dans un second effet — deux propriétaires rendent l’annulation et la gestion des résultats périmés ambiguës.

## Posséder le travail realtime

Les handles SSE et WebSocket survivent à `client.execute(...)`. Enregistre le cleanup avant d’attendre le démarrage, ferme un handle qui arrive après disposal, consomme son unique itérateur, attends sa promesse terminale :

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

Même règle pour `EventStreamHandle` : ferme dans `finally`, attends `stream.closed`. Les consommateurs WebSocket doivent aussi se désabonner des écouteurs d’état/erreurs runtime et continuer à lire `session.receive` — une queue bornée non lue peut overflow.

## SSR et portée client

L’entrée du package est une frontière Client Component. Une app navigateur peut partager un client module-scoped quand endpoint, intercepteurs et état capturé sont safe navigateur et indépendants de la requête. Pour le SSR, crée un client séparé dans chaque frontière de requête quand headers, cookies, utilisateurs, tenants ou credentials diffèrent.

L’unmount du provider n’aborte **pas** HTTP, ne ferme pas SSE/WebSocket, ne désabonne pas les écouteurs et n’appelle pas `dispose`. `@defjs/react` n’a pas une telle API de cycle de vie. Le code qui démarre chaque opération doit la finir ou l’annuler.

## Référence

Exports publics depuis `@defjs/react` :

- `ClientProvider` — accepte `ClientProviderProps`, fournit le client fourni
- `useClient` — client le plus proche, ou throw
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

Crée clients et options dans `@defjs/core`. Voir [Client](../core/client.md), [Erreurs](../core/errors.md), [SSE](../core/sse.md) et [WebSocket](../core/web-socket.md).

## Recettes liées

- [GET avec un 404 déclaré](../recipes/get-declared-404.md)
- [Annuler un appel HTTP](../recipes/cancel-http.md)
- [Consommer un flux SSE](../recipes/consume-sse.md)
- [Ouvrir une session WebSocket](../recipes/websocket-session.md)
