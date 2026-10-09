---
title: React
description: Instala el provider, lee el cliente, carga un usuario y aborta cuando el effect se reejecuta.
---

# React

Conecta un cliente `@defjs/core` existente a un árbol React. Obtienes Context y `useClient()`. El paquete **no** crea un cliente, no añade caché, no reintenta comandos ni dispone recursos de transporte. El componente, effect o librería de datos que arranca el trabajo es su dueño.

## Basic Setup

Instala `@defjs/core`, `@defjs/react` y React 18+. ESM; Node.js 22+ cuando corres en Node:

`bun add @defjs/core @defjs/react react`

Proporciona el cliente, luego carga un usuario y aborta al cambiar:

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

`ClientProvider` es un provider de Context normal. Una prop `client` distinta cambia lo que ven los descendientes — sin clone, replace ni dispose. Los providers anidados crean límites explícitos.

React puede montar y limpiar un effect más de una vez en desarrollo. La comprobación del signal evita que una promesa obsoleta escriba en el render actual. El error de la tupla sigue siendo data.

## Leer con `useClient`

`useClient()` devuelve el `Client` más cercano. Llámalo durante el render (componente o custom hook). Lanza cuando no hay provider:

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

El hook solo suministra el cliente. No arranca trabajo, no se suscribe a un transporte ni convierte la tupla error-first en una excepción.

## Ser dueño del trabajo de query

Una librería de queries puede ser dueña de la caché, los reintentos, la supresión de resultados obsoletos y la cancelación. Dale el signal que ella proporciona:

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

No envuelvas el mismo comando en un segundo effect — dos dueños hacen ambigua la cancelación y el manejo de resultados obsoletos.

## Ser dueño del trabajo realtime

Los handles SSE y WebSocket sobreviven a `client.execute(...)`. Registra la limpieza antes de esperar el arranque, cierra un handle que llega tras la disposición, consume su único iterador, espera su promesa terminal:

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

Misma regla para `EventStreamHandle`: cierra en `finally`, await `stream.closed`. Los consumidores WebSocket también deben hacer unsubscribe de listeners de estado/runtime-error y seguir leyendo `session.receive` — una cola acotada sin leer puede hacer overflow.

## SSR y ámbito del cliente

La entrada del paquete es un límite de Client Component. Una app de navegador puede compartir un cliente a nivel de módulo cuando endpoint, interceptores y estado capturado son seguros para el navegador e independientes de la solicitud. Para SSR, crea un cliente separado dentro de cada límite de solicitud cuando cabeceras, cookies, usuarios, tenants o credenciales difieren.

El unmount del provider **no** aborta HTTP, no cierra SSE/WebSocket, no hace unsubscribe de listeners ni llama a `dispose`. `@defjs/react` no tiene esa API de ciclo de vida. El código que arranca cada operación debe terminarla o cancelarla.

## Reference

Exports públicos de `@defjs/react`:

- `ClientProvider` — acepta `ClientProviderProps`, proporciona el cliente suministrado
- `useClient` — cliente más cercano, o lanza
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

Crea clientes y opciones en `@defjs/core`. Ver [Cliente](../core/client.md), [Errores](../core/errors.md), [SSE](../core/sse.md) y [WebSocket](../core/web-socket.md).

## Recetas relacionadas

- [GET con un 404 declarado](../recipes/get-declared-404.md)
- [Cancelar una llamada HTTP](../recipes/cancel-http.md)
- [Consumir un stream SSE](../recipes/consume-sse.md)
- [Abrir una sesión WebSocket](../recipes/websocket-session.md)
