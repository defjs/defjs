---
title: '@defjs/react'
description: ClientProvider、useClient，以及 provider props。
---

# React {#page}

把既有的 `@defjs/core` client 提供給 React 樹。這個套件不會建立、快取或 dispose client。

見 [React 指南](/plugins/react)。

## ClientProvider {#ClientProvider}

```ts
function ClientProvider(props: ClientProviderProps): ReactElement
```

Context provider。把 `createClient` 給的 client 傳進去。

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

讀最近的 `ClientProvider`。

- **回傳** 提供的 client。
- **拋出** 在 `ClientProvider` 外面呼叫時。

## ClientProviderProps {#ClientProviderProps}

```ts
interface ClientProviderProps {
  client: Client
  children?: ReactNode
}
```
