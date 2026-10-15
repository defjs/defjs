import { createClient, createHttpInterceptor, defineRequest, struct, type Client, withEndpoint, withInterceptors } from '@defjs/core'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement, useEffect, useState } from 'react'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { ClientProvider, useClient } from './core'

afterEach(cleanup)

const UserStruct = struct.object({
  id: struct.number(),
  name: struct.string(),
})

const getUsers = defineRequest({
  method: 'GET',
  path: '/api/users',
  output: struct.array(UserStruct),
})

function UserList() {
  const client = useClient()
  const [users, setUsers] = useState<Array<{ id: number; name: string }>>([])

  useEffect(() => {
    client.execute(getUsers()).then(([, result]) => {
      if (result) {
        setUsers(result as Array<{ id: number; name: string }>)
      }
    })
  }, [client])

  return createElement(
    'ul',
    { 'data-testid': 'user-list' },
    users.map((user) => createElement('li', { key: user.id, 'data-testid': `user-${user.id}` }, user.name)),
  )
}

function App({ client }: { client: Client }) {
  return createElement(ClientProvider, { client }, createElement('div', null, createElement('h1', null, 'Users'), createElement(UserList)))
}

describe('React wrapper e2e', () => {
  it('should fetch and render real data through useClient', async () => {
    const endpoint = inject('testServerHost')

    render(createElement(App, { client: createClient(withEndpoint(endpoint)) }))

    await waitFor(() => {
      expect(screen.getByTestId('user-1').textContent).toBe('John')
      expect(screen.getByTestId('user-2').textContent).toBe('Jane')
    })
  })

  it('should provide the same client instance to nested components', () => {
    const endpoint = inject('testServerHost')
    const clients: unknown[] = []

    function DeepChild() {
      clients.push(useClient())
      return null
    }

    function MiddleChild() {
      clients.push(useClient())
      return createElement(DeepChild)
    }

    const client = createClient(withEndpoint(endpoint))
    render(createElement(ClientProvider, { client }, createElement(MiddleChild)))

    expect(clients.length).toBe(2)
    expect(clients[0]).toBe(clients[1])
  })

  it('should resolve the nearest client provider in nested component trees', async () => {
    const endpoint = inject('testServerHost')
    const seenScopes: string[] = []
    let outerClient: unknown
    let outerSiblingClient: unknown
    let innerMiddleClient: unknown
    let innerLeafClient: unknown

    const scopedInterceptor = (scope: string) =>
      createHttpInterceptor(async (req, next) => {
        seenScopes.push(scope)
        req.headers?.set('x-defjs-scope', scope)
        return next(req)
      })

    function OuterRequestConsumer() {
      const client = useClient()
      const [count, setCount] = useState('loading')
      outerClient = client

      useEffect(() => {
        client.execute(getUsers()).then(([error, users]) => {
          if (error) {
            setCount('error')
            return
          }

          setCount(String((users as Array<{ id: number; name: string }>).length))
        })
      }, [client])

      return createElement('span', { 'data-testid': 'outer-count' }, count)
    }

    function OuterSiblingConsumer() {
      outerSiblingClient = useClient()
      return null
    }

    function InnerMiddle() {
      innerMiddleClient = useClient()
      return createElement(InnerLeaf)
    }

    function InnerLeaf() {
      const client = useClient()
      const [count, setCount] = useState('loading')
      innerLeafClient = client

      useEffect(() => {
        client.execute(getUsers()).then(([error, users]) => {
          if (error) {
            setCount('error')
            return
          }

          setCount(String((users as Array<{ id: number; name: string }>).length))
        })
      }, [client])

      return createElement('span', { 'data-testid': 'inner-count' }, count)
    }

    const outer = createClient(withEndpoint(endpoint), withInterceptors(scopedInterceptor('outer')))
    const inner = createClient(withEndpoint(endpoint), withInterceptors(scopedInterceptor('inner')))

    render(
      createElement(
        ClientProvider,
        { client: outer },
        createElement(OuterRequestConsumer),
        createElement(ClientProvider, { client: inner }, createElement(InnerMiddle)),
        createElement(OuterSiblingConsumer),
      ),
    )

    await waitFor(() => {
      expect(screen.getByTestId('outer-count').textContent).toBe('2')
      expect(screen.getByTestId('inner-count').textContent).toBe('2')
    })

    expect(outerClient).toBeDefined()
    expect(outerSiblingClient).toBeDefined()
    expect(innerMiddleClient).toBeDefined()
    expect(innerLeafClient).toBeDefined()
    expect(outerClient).toBe(outerSiblingClient)
    expect(innerMiddleClient).toBe(innerLeafClient)
    expect(innerLeafClient).not.toBe(outerClient)
    expect(outerClient).toBe(outer)
    expect(innerLeafClient).toBe(inner)
    expect([...seenScopes].sort()).toEqual(['inner', 'outer'])
  })
})
