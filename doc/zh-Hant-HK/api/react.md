---
title: '@defjs/react'
description: ClientProvider、useClient，同 provider props。
---

# React {#page}

將現有 `@defjs/core` client 提供俾 React tree。呢個 package 唔會 create、cache 或者 dispose client。

見 [React guide](/plugins/react)。

## ClientProvider {#ClientProvider}

```ts
function ClientProvider(props: ClientProviderProps): ReactElement
```

Context provider。傳入 `createClient` 俾嘅 client。

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

讀最近嘅 `ClientProvider`。

- **Returns** 提供嘅 client。
- **Throws** 喺 `ClientProvider` 外面 call 嗰陣。

## ClientProviderProps {#ClientProviderProps}

```ts
interface ClientProviderProps {
  client: Client
  children?: ReactNode
}
```
