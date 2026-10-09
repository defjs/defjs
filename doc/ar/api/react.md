---
title: '@defjs/react'
description: ClientProvider وuseClient وخصائص المزوّد.
---

# React {#page}

وفّر عميل `@defjs/core` موجودًا لشجرة React. هذه الحزمة لا تنشئ العميل ولا تخزّنه ولا تتخلّص منه.

انظر [دليل React](/plugins/react).

## ClientProvider {#ClientProvider}

```ts
function ClientProvider(props: ClientProviderProps): ReactElement
```

موفر السياق. مرّر عميلًا من `createClient`.

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

يقرأ أقرب `ClientProvider`.

- **يعيد** العميل الموفَّر.
- **يرمي** خارج `ClientProvider`.

## ClientProviderProps {#ClientProviderProps}

```ts
interface ClientProviderProps {
  client: Client
  children?: ReactNode
}
```
