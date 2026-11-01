"use client";

import type { DerivableClient } from "@defjs/core";
import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

const HttpClientContext = createContext<DerivableClient | null>(null);

/**
 * Props of {@link ClientProvider}: the required `client` and optional `children`.
 *
 * @group react
 */
export interface ClientProviderProps {
  /** Derivable client returned by `createClient`, owned by the application. */
  client: DerivableClient;
  /** React tree that can call {@link useClient}. */
  children?: ReactNode;
}

/**
 * Provide a Defjs client to React descendants via context.
 *
 * Pass the client returned by `createClient` as `client`; descendants read it with `useClient`. The component does not create, cache, or dispose the client. A nested `ClientProvider` overrides the client for its own subtree, and a different `client` prop changes the context value for descendants.
 *
 * @param props - `client` and optional `children`.
 * @returns A context provider element.
 *
 * @group react
 * @see {@link DerivableClient}
 * @see {@link ClientProviderProps}
 * @exampleFile examples/react/client-provider.tsx#example
 */
export function ClientProvider({
  client,
  children,
}: ClientProviderProps): React.FunctionComponentElement<
  React.ProviderProps<DerivableClient | null>
> {
  return createElement(HttpClientContext.Provider, { value: client }, children);
}

/**
 * React Hook that returns an explicit Defjs client or the nearest {@link ClientProvider}.
 *
 * `useClient(overrideClient)` prefers the exact explicit client; omitted or `undefined` reads the nearest `ClientProvider`. An `Error` is thrown only when neither source supplies a client. Zero-argument `useClient()` calls remain valid.
 *
 * Always call `useClient(explicitClient)` at the top level of a component or custom Hook, even with an explicit client; not in an ordinary function or event callback. Do not write `explicitClient ?? useClient()`, which conditionally calls a Hook. The override does not write Context or create a provider, and the Hook still subscribes to Context.
 *
 * The returned value is the exact `DerivableClient` that was supplied. Call it with request options at the call site to derive a `Client` value for one call: `getUser(client({ signal }), input)`. It is a function, so do not pass it to `useState` or a state setter: React calls a function argument as a lazy initializer or an updater. The provider holds only a root client; a derived `Client` value is not accepted, so create it where the operation is called.
 *
 * @param overrideClient - Derivable client to use before context; `undefined` uses the provider.
 * @returns The selected derivable client.
 * @throws If neither an explicit client nor a `ClientProvider` is available.
 *
 * @example
 * ```tsx
 * const client = useClient()
 * ```
 * @group react
 * @see {@link DerivableClient}
 */
export function useClient(overrideClient?: DerivableClient): DerivableClient {
  const providedClient = useContext(HttpClientContext);
  const client = overrideClient ?? providedClient;

  if (!client) {
    throw new Error(
      "No Defjs client provided. Did you forget to wrap your app in <ClientProvider>?",
    );
  }

  return client;
}
