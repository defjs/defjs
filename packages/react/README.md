# @defjs/react

Thin React plugin for `@defjs/core`: it provides an application-owned client through React Context. It adds no query layer, cache, Suspense integration, or state management, and never creates, replaces, or disposes a client.

Keeping SDK definitions in their own package means the SDK needs no React dependency. Requires React 18 or later; the published entry is marked `'use client'`.

## Install

```sh
bun add @defjs/core @defjs/react react
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.4.0` range.

## Quick start

```tsx
// api.ts — reusable definition
import { defineRequest, struct } from "@defjs/core";

export const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
});
```

```tsx
// app.tsx
import { createClient, withEndpoint } from "@defjs/core";
import { ClientProvider } from "@defjs/react";
import { UserProfile } from "./user-profile";

const client = createClient(withEndpoint("https://api.example.com"));

export function App() {
  return (
    <ClientProvider client={client}>
      <UserProfile id={1} />
    </ClientProvider>
  );
}
```

Read the client with `useClient()` and own request cleanup where the work starts:

```tsx
import { useEffect, useState } from "react";
import { useClient } from "@defjs/react";
import { getUser } from "./api";

export function UserProfile({ id }: { id: number }) {
  const client = useClient();
  const [name, setName] = useState("loading...");

  useEffect(() => {
    const abort = new AbortController();

    const command = getUser({ id });
    void client
      .execute(command, { signal: abort.signal })
      .then(([error, user]) => {
        if (abort.signal.aborted) return;
        if (error) {
          setName(error.message);
          return;
        }
        setName(user.name);
      });

    return () => abort.abort();
  }, [client, id]);

  return <div>{name}</div>;
}
```

## API

### `<ClientProvider client={client}>`

Provides the exact supplied `Client` to descendants. Nested providers follow normal React Context rules.

### `useClient(overrideClient?): Client`

Returns `overrideClient` when supplied, otherwise the nearest provided client. Throws only when neither source supplies one. Call it at the top level of a component or Hook — never as `explicitClient ?? useClient()`, which conditionally calls a Hook. The override does not write Context.

## Notes

- Create request-specific clients (SSR data with credentials, cookies, or tenant state) at the application boundary.
- The owner that creates a client also owns its requests, SSE streams, and WebSocket sessions. Provider unmount does not clean them up.
- Import `createClient`, `withEndpoint`, `withInterceptors`, and other client options from `@defjs/core`.

## Documentation

- [React API](https://defjs.lyz.cloud/api/react) · [React guide](https://defjs.lyz.cloud/docs/integrations/react)

## License

MIT.
