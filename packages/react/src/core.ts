'use client'

import type { Client } from '@defjs/core'
import { createContext, createElement, useContext, type ReactNode } from 'react'

const HttpClientContext = createContext<Client | null>(null)

/** Props for {@link ClientProvider}. */
export interface ClientProviderProps {
  /** Defjs client owned by the application. */
  client: Client
  /** React tree that can call {@link useClient}. */
  children?: ReactNode
}

/**
 * Provide a Defjs client to React descendants via context.
 *
 * Does not create, cache, or dispose the client — pass an existing instance.
 *
 * @param props - `client` and optional `children`.
 * @returns A context provider element.
 *
 * @example
 * ```tsx
 * <ClientProvider client={client}>
 *   <App />
 * </ClientProvider>
 * ```
 */
export function ClientProvider({ client, children }: ClientProviderProps) {
  return createElement(HttpClientContext.Provider, { value: client }, children)
}

/**
 * Read the Defjs client from the nearest {@link ClientProvider}.
 *
 * @returns The provided `Client`.
 * @throws If called outside a `ClientProvider`.
 *
 * @example
 * ```tsx
 * const client = useClient()
 * ```
 */
export function useClient(): Client {
  const client = useContext(HttpClientContext)

  if (!client) {
    throw new Error('No Defjs client provided. Did you forget to wrap your app in <ClientProvider>?')
  }

  return client
}
