# @defjs/react

Thin React plugin for `@defjs/core`. It provides an existing Defjs client through React Context.

Keep reusable SDK definitions in their own package or module. A React application configures the client, provides it to components, and executes those definitions through `useClient()`. The SDK does not need a React dependency or a component-owned client.

This plugin is optional: import a fixed application-owned client, pass a `Client` explicitly, use Context for tree-level defaults and overrides, or choose your own organization. SDK definitions do not require this plugin. Share an instance only when its captured configuration and state are safe to share; request-specific identity or credentials belong to the appropriate request boundary.

Supports React 18+.

## Install

```sh
bun add @defjs/core @defjs/react react
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.4.0` range. Its tarball retains this `README.md` and the repository `LICENSE`; repository-wide guides and examples remain outside the package.

## What this package does

`ClientProvider` exposes the exact `Client` instance supplied by the application. `useClient()` reads the nearest provided instance.

Client creation and configuration stay in `@defjs/core`. The plugin does not create, cache, replace, dispose, abort, or close anything on behalf of the application, and it does not add a query layer, Suspense integration, GraphQL client, or application state management.

## Quick Start

Define the SDK's requests in a shared module, or import them from your published SDK:

```tsx
// api.ts
import { defineRequest, struct } from "@defjs/core";

export const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
});
```

Create and own the client at the application boundary, then provide it:

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

Read the client inside descendants and own request cleanup where the work starts. Best practice: name the command, pass that name to `execute`, and return before reading the user when `error` is set. Abort still belongs to the effect:

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

Nested providers follow normal React Context rules: descendants receive the nearest provider's exact client. Supplying a different `client` prop changes the provided value; the plugin does not invent a remount or caching policy.

## API

### `<ClientProvider client: Client>`

Provides the supplied client to descendant components. `children` is optional.

### `useClient(): Client`

```ts
function useClient(overrideClient?: Client): Client;
```

Returns the exact `overrideClient` when supplied; omitted or `undefined` reads the nearest `ClientProvider`. Throws an `Error` only when neither source supplies a client. Zero-argument calls remain valid.

Always call `useClient(explicitClient)` at the top level of a component or custom Hook, even with an explicit client; not in an ordinary function or event callback. Do not write `explicitClient ?? useClient()`, which conditionally calls a Hook. The override does not write Context or create a provider, and the Hook still subscribes to Context.

## Notes

- The published entry is marked with `'use client'`, so React Server Component consumers treat this plugin as a client boundary.
- Create request-specific clients at the application boundary for SSR data that contains credentials, cookies, or tenant state.
- The owner that creates a client also owns all requests, SSE streams, and WebSocket sessions started through it. Provider unmount does not clean them up automatically.
- Import `createClient`, `withEndpoint`, `withInterceptors`, and all other client options from `@defjs/core`.

## License

MIT License.
