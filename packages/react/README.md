# @defjs/react

Thin React adapter for `@defjs/core`. It provides an existing Defjs client through React Context.

Supports React 18+.

## Install

```sh
bun add @defjs/core @defjs/react react
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.4.0` range. Its tarball retains this `README.md` and the repository `LICENSE`; repository-wide guides and examples remain outside the package.

## What this package does

`ClientProvider` exposes the exact `Client` instance supplied by the application. `useClient()` reads the nearest provided instance.

Client creation and configuration stay in `@defjs/core`. The adapter does not create, cache, replace, dispose, abort, or close anything on behalf of the application, and it does not add a query layer, Suspense integration, GraphQL client, or application state management.

## Quick Start

Define requests in a shared module:

```tsx
// api.ts
import { defineRequest, struct } from '@defjs/core'

export const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
})
```

Create and own the client at the application boundary, then provide it:

```tsx
// app.tsx
import { createClient, withEndpoint } from '@defjs/core'
import { ClientProvider } from '@defjs/react'
import { UserProfile } from './user-profile'

const client = createClient(withEndpoint('https://api.example.com'))

export function App() {
  return (
    <ClientProvider client={client}>
      <UserProfile id={1} />
    </ClientProvider>
  )
}
```

Read the client inside descendants and own request cleanup where the work starts:

```tsx
import { useEffect, useState } from 'react'
import { useClient } from '@defjs/react'
import { getUser } from './api'

export function UserProfile({ id }: { id: number }) {
  const client = useClient()
  const [name, setName] = useState('loading...')

  useEffect(() => {
    const abort = new AbortController()

    void client.execute(getUser({ path: { id } }), { signal: abort.signal }).then(([error, user]) => {
      if (!abort.signal.aborted) setName(error ? error.message : user.name)
    })

    return () => abort.abort()
  }, [client, id])

  return <div>{name}</div>
}
```

Nested providers follow normal React Context rules: descendants receive the nearest provider's exact client. Supplying a different `client` prop changes the provided value; the adapter does not invent a remount or caching policy.

## API

### `<ClientProvider client: Client>`

Provides the supplied client to descendant components. `children` is optional.

### `useClient(): Client`

Returns the client from the nearest `ClientProvider`. Throws if called outside a provider.

## Notes

- The published entry is marked with `'use client'`, so React Server Component consumers treat this adapter as a client boundary.
- Create request-specific clients at the application boundary for SSR data that contains credentials, cookies, or tenant state.
- The owner that creates a client also owns all requests, SSE streams, and WebSocket sessions started through it. Provider unmount does not clean them up automatically.
- Import `createClient`, `withEndpoint`, `withInterceptors`, and all other client options from `@defjs/core`.

## License

MIT License.
