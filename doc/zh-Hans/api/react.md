---
title: '@defjs/react'
description: 装 provider、读 Client。
---

# React {#page}

把已有的 `@defjs/core` Client 接到 React 树。这个包**不会**创建 Client、加缓存，也不会释放传输资源。

见 [React 指南](/plugins/react)。

## ClientProvider {#ClientProvider}

```ts
function ClientProvider(props: ClientProviderProps): ReactElement
```

Context provider。把 `createClient` 给的 Client 传进去。

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

读最近的 `ClientProvider`。

- **返回** 提供的 Client。
- **抛出** 在 `ClientProvider` 外面调用时。

## ClientProviderProps {#ClientProviderProps}

```ts
interface ClientProviderProps {
  client: Client
  children?: ReactNode
}
```
