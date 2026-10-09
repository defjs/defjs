---
title: '@defjs/react'
description: ClientProvider, useClient y props del provider.
---

# React {#page}

Proporciona un cliente `@defjs/core` existente a un árbol React. Este paquete no crea, no cachea ni dispone el cliente.

Mira la [guía de React](/plugins/react).

## ClientProvider {#ClientProvider}

```ts
function ClientProvider(props: ClientProviderProps): ReactElement
```

Provider de contexto. Pasa un cliente de `createClient`.

```tsx
import { createClient, withEndpoint } from '@defjs/core'
import { ClientProvider } from '@defjs/react'
import type { ReactNode } from 'react'

const client = createClient(withEndpoint('https://api.example.com'))

export function ApiProvider({ children }: { children: ReactNode }) {
  return <ClientProvider client={client}>{children}</ClientProvider>
}
```

## useClient() {#useClient}

```ts
function useClient(): Client
```

Lee el `ClientProvider` más cercano.

- **Devuelve** el cliente proporcionado.
- **Lanza** si se llama fuera de un `ClientProvider`.

## ClientProviderProps {#ClientProviderProps}

```ts
interface ClientProviderProps {
  client: Client
  children?: ReactNode
}
```
