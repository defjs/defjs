---
title: '@defjs/react'
description: ClientProvider, useClient und Provider-Props.
---

# React {#page}

Stelle einen bestehenden `@defjs/core`-Client einem React-Tree bereit. Dieses Paket erzeugt, cached oder disposed den Client nicht.

Siehe den [React-Guide](/plugins/react).

## ClientProvider {#ClientProvider}

```ts
function ClientProvider(props: ClientProviderProps): ReactElement
```

Context-Provider. Übergib einen Client von `createClient`.

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

Liest den nächsten `ClientProvider`.

- **Returns** den bereitgestellten Client.
- **Throws** außerhalb eines `ClientProvider`.

## ClientProviderProps {#ClientProviderProps}

```ts
interface ClientProviderProps {
  client: Client
  children?: ReactNode
}
```
