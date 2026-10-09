---
title: '@defjs/react'
description: ClientProvider, useClient, provider props예요.
---

# React {#page}

기존 `@defjs/core` 클라이언트를 React 트리에 제공해요. 이 패키지는 클라이언트를 만들거나, 캐시하거나, dispose하지 않아요.

[React 가이드](/plugins/react)를 보세요.

## ClientProvider {#ClientProvider}

```ts
function ClientProvider(props: ClientProviderProps): ReactElement
```

Context provider예요. `createClient`가 준 클라이언트를 넣어요.

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

가장 가까운 `ClientProvider`를 읽어요.

- **반환** 제공된 클라이언트예요.
- **던짐** `ClientProvider` 밖에서 호출했을 때예요.

## ClientProviderProps {#ClientProviderProps}

```ts
interface ClientProviderProps {
  client: Client
  children?: ReactNode
}
```
