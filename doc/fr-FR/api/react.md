---
title: '@defjs/react'
description: ClientProvider, useClient, et props du provider.
---

# React {#page}

Fournis un client `@defjs/core` existant à un arbre React. Ce paquet ne crée pas, ne met pas en cache et ne dispose pas le client.

Voir le [guide React](/plugins/react).

## ClientProvider {#ClientProvider}

```ts
function ClientProvider(props: ClientProviderProps): ReactElement
```

Provider de contexte. Passe un client de `createClient`.

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

Lit le `ClientProvider` le plus proche.

- **Renvoie** le client fourni.
- **Lève** hors d’un `ClientProvider`.

## ClientProviderProps {#ClientProviderProps}

```ts
interface ClientProviderProps {
  client: Client
  children?: ReactNode
}
```
