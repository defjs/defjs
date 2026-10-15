import { createClient, type Client } from '@defjs/core'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ClientProvider, useClient } from './core'

afterEach(cleanup)

describe('ClientProvider', () => {
  it('provides the exact client instance supplied by the caller', () => {
    const client = createClient()
    let injectedClient: Client | undefined

    function Child() {
      injectedClient = useClient()
      return null
    }

    render(createElement(ClientProvider, { client }, createElement(Child)))

    expect(injectedClient).toBe(client)
  })

  it('resolves the nearest client in nested provider trees', () => {
    const outerClient = createClient()
    const innerClient = createClient()
    let outerInjectedClient: Client | undefined
    let innerInjectedClient: Client | undefined

    function OuterChild() {
      outerInjectedClient = useClient()
      return createElement(ClientProvider, { client: innerClient }, createElement(InnerChild))
    }

    function InnerChild() {
      innerInjectedClient = useClient()
      return null
    }

    render(createElement(ClientProvider, { client: outerClient }, createElement(OuterChild)))

    expect(outerInjectedClient).toBe(outerClient)
    expect(innerInjectedClient).toBe(innerClient)
  })
})

describe('useClient', () => {
  it('throws when no provider is present', () => {
    function Child() {
      useClient()
      return null
    }

    expect(() => render(createElement(Child))).toThrow('No Defjs client provided. Did you forget to wrap your app in <ClientProvider>?')
  })
})
